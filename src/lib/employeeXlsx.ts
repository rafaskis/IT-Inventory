const MAX_FILE_BYTES = 5 * 1024 * 1024

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) return offset
  }
  throw new Error('The uploaded file is not a valid Excel workbook.')
}

async function unzipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const eocd = findEndOfCentralDirectory(bytes)
  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  const entries = new Map<string, Uint8Array>()

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The Excel workbook structure is invalid.')
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('The Excel workbook contains an invalid file entry.')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(dataStart, dataStart + compressedSize)
    let content: Uint8Array
    if (method === 0) content = compressed
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Your browser does not support Excel uploads. Please use an up-to-date version of Chrome or Edge.')
      const stream = new Blob([compressed.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat))
      content = new Uint8Array(await new Response(stream).arrayBuffer())
    } else throw new Error('This Excel workbook uses an unsupported compression method.')
    entries.set(name, content)
  }
  return entries
}

function xml(entries: Map<string, Uint8Array>, path: string): Document {
  const content = entries.get(path)
  if (!content) throw new Error('The Excel workbook is missing required worksheet data.')
  const parsed = new DOMParser().parseFromString(new TextDecoder().decode(content), 'application/xml')
  if (parsed.querySelector('parsererror')) throw new Error('The Excel worksheet could not be read.')
  return parsed
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  let result = 0
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64
  return result - 1
}

export type EmployeeImportRow = { rowNumber: number; fullName: string }

export async function readEmployeesWorkbook(file: File): Promise<EmployeeImportRow[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error('The Excel file cannot exceed 5 MB.')
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Please upload an .xlsx Excel file.')
  const entries = await unzipEntries(await file.arrayBuffer())
  const workbook = xml(entries, 'xl/workbook.xml')
  const firstSheet = workbook.getElementsByTagName('sheet')[0]
  if (!firstSheet) throw new Error('The workbook does not contain a worksheet.')
  const relationshipId = firstSheet.getAttribute('r:id')
  const relationships = xml(entries, 'xl/_rels/workbook.xml.rels')
  const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === relationshipId)
  const target = relationship?.getAttribute('Target')
  if (!target) throw new Error('The first worksheet could not be located.')
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const sheet = xml(entries, sheetPath)
  const rows = Array.from(sheet.getElementsByTagName('row'))
  if (rows.length < 2) throw new Error('The worksheet contains no employee rows.')
  const shared = entries.has('xl/sharedStrings.xml') ? xml(entries, 'xl/sharedStrings.xml') : null
  const sharedStrings = shared ? Array.from(shared.getElementsByTagName('si')).map((item) => Array.from(item.getElementsByTagName('t')).map((part) => part.textContent ?? '').join('')) : []
  const headerCells = Array.from(rows[0].getElementsByTagName('c'))
  const headers = new Map<number, string>()
  for (const cell of headerCells) {
    const inline = Array.from(cell.getElementsByTagName('t')).map((part) => part.textContent ?? '').join('')
    const raw = cell.getElementsByTagName('v')[0]?.textContent ?? ''
    const value = cell.getAttribute('t') === 'inlineStr' ? inline : cell.getAttribute('t') === 's' ? (sharedStrings[Number(raw)] ?? '') : raw
    headers.set(columnIndex(cell.getAttribute('r') ?? ''), value)
  }
  const expected = ['Full name']
  if (headers.size !== 1 || expected.some((value, index) => headers.get(index) !== value)) {
    throw new Error('Incorrect template. The first worksheet must have exactly one column named Full name.')
  }

  const result: EmployeeImportRow[] = []
  for (const row of rows.slice(1)) {
    const values = new Map<number, string>()
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const index = columnIndex(cell.getAttribute('r') ?? '')
      const type = cell.getAttribute('t')
      const raw = cell.getElementsByTagName('v')[0]?.textContent ?? ''
      const value =
        type === 'inlineStr'
          ? Array.from(cell.getElementsByTagName('t')).map((part) => part.textContent ?? '').join('')
          : type === 's'
            ? (sharedStrings[Number(raw)] ?? '')
            : raw
      values.set(index, value)
    }
    const fullName = (values.get(0) ?? '').trim()
    if (!fullName) continue
    result.push({ rowNumber: Number(row.getAttribute('r') ?? result.length + 2), fullName })
    if (result.length > 1000) throw new Error('A maximum of 1,000 employee rows can be imported at once.')
  }
  if (!result.length) throw new Error('The worksheet contains no employee data.')
  return result
}
