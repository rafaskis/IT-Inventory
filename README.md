# MJPO Inventory

**IT equipment inventory and lifecycle management system**  
Application: [https://rafaskis.github.io/IT-Inventory/](https://rafaskis.github.io/IT-Inventory/)

MJPO Inventory is the internal system for recording and monitoring the organisation's IT equipment. It brings together equipment records, employee assignments, locations, catalogues, lifecycle procedures, imports, exports and audit history in one application.

The interface is available in **Greek and English**. Each user signs in with an individual account created by an Administrator; public self-registration is disabled.

---

## Contents

1. [Getting started](#getting-started)
2. [Roles and access](#roles-and-access)
3. [Navigation and common controls](#navigation-and-common-controls)
4. [Dashboard](#dashboard)
5. [Inventory register](#inventory-register)
6. [Equipment lifecycle](#equipment-lifecycle)
7. [Employees](#employees)
8. [Locations](#locations)
9. [Catalogues](#catalogues)
10. [Batch Import](#batch-import)
11. [PDF exports](#pdf-exports)
12. [Audit Logs](#audit-logs)
13. [Accounts](#accounts)
14. [Settings](#settings)
15. [Database flush](#database-flush)
16. [Good practices](#good-practices)

## Getting started

1. Open the [MJPO Inventory application](https://rafaskis.github.io/IT-Inventory/).
2. Enter the username and password supplied by the Administrator.
3. Select **Sign in**.

There is no public self-registration. Contact an Administrator if you need an account or a change to your access level.

After signing in, the application opens on the Dashboard or on the default page saved in your account preferences.

## Roles and access

The application has three roles. The available pages and actions are enforced by the application and its backend.

**Legend**

- **None** — no access to the section or operation.
- **Read** — view, search, filter and use available read-only exports.
- **Write** — create, edit, delete or perform the relevant operational actions. Some completed lifecycle records remain read-only for every role.

| Application section / function | Administrator | Inventory Manager | Viewer |
|---|:---:|:---:|:---:|
| Dashboard | Read | Read | Read |
| Main Inventory | Write | Write | Read |
| To be scrapped | Write | Write | Read |
| Scrapped records | Read | Read | Read |
| Goods issued to other services | Read | Read | Read |
| Employees | Write | Write | Read |
| Locations | Write | Write | Read |
| Catalogues | Write | Write | Read |
| Audit Logs — operational (inventory, employees, locations, catalogues) | Read | Read | Read |
| Audit Logs — Security & Accounts | Read | None | None |
| Account Management | Write | None | None |
| Batch Import (inventory, employees, locations) | Write | Write | None |
| Settings — own account and preferences | Write | Write | Write |
| Global Search | Read | Read | Read |
| Flush whole database | Write | None | None |

The **Inventory Manager** can manage employees, locations and catalogues, create locations directly from the inventory item form, and use all three Batch Import workflows. The **Viewer** has read-only access to inventory, employees, locations, catalogues and operational audit history. Account management, Security & Accounts audit history and database flush are Administrator-only.

## Navigation and common controls

The main navigation is on the left. On smaller screens, use the menu button in the header to open it.

- **Global Search:** Select the magnifying-glass control in the header or press `Ctrl+K`. Enter at least two characters to search inventory identifiers, employee names, locations and catalogue entries. Select a result to open the relevant section.
- **Refresh:** Use the Refresh control on a page to reload its records.
- **Sign out:** Use Sign out in the navigation panel when you finish.

## Dashboard

The Dashboard provides an overview of the registered equipment and quick access to the main inventory categories:

- **Main Inventory** — active equipment.
- **To be scrapped** — equipment for which the scrapping process has started.
- **Scrapped** — equipment whose final scrapping stage is complete.
- **Goods issued to other services** — equipment recorded as issued to another service.

Use the Dashboard cards or the left navigation to open a category.

## Inventory register

The Inventory page is the main equipment register.

### Find equipment

- Use the search field for item code, serial number, MAC address, PC name, IP address, invoice reference, store, EOASIS document number and notes.
- Open **Filters** to narrow results by item type, brand, model, employee, location, purchase date or warranty date.
- Use **Hide shared items?** to exclude shared equipment from the results.
- Select **Clear all** to remove the current search and filters.
- Select column headings to sort where available.
- Use the column selector to show or hide fields and Reset to restore the default columns.
- Choose the number of rows per page and use the page controls to browse the results.

### Add equipment

Administrators and Inventory Managers can select **Add Inventory Item**. Complete the required item type, brand, model and location fields. Add other available information such as serial number, MAC address, PC name, IP address, socket, EOASIS document number, invoice, purchase date, warranty date, store and notes.

You can assign one or more employees to an item. You can also create a new employee, item type, brand, model or location directly from the form when needed. The application generates the item code.

Review the information and select **Create Item**.

### Edit equipment

Administrators and Inventory Managers can open the edit control beside an item, update its information and select **Save Changes**. The form also supports updating employee assignments and creating related reference entries where permitted.

### Bulk edit

1. Select the relevant inventory items.
2. If available, use **Select all matching items** to select the matching result set (up to 500 items).
3. Select **Bulk edit**.
4. Choose the fields to update and review the values.
5. Apply the changes.

Only selected fields are changed. When employee assignments are included, the selected assignments replace the existing assignments on the chosen items.

## Equipment lifecycle

Equipment moves through the following lifecycle sections:

**Main Inventory → To be scrapped → Scrapped**  
Equipment may also move from **Main Inventory → Goods issued to other services**.

### Move to To be scrapped

1. In Main Inventory, select one or more items.
2. Start the transition to **To be scrapped**.
3. Enter the **ΓΕΝ.118** reference and the transition date.
4. Review the warning and confirm the irreversible operation.

### Complete scrapping

1. Open **To be scrapped**.
2. Select the items to complete.
3. Enter the **ΓΕΝ.36** reference and date.
4. Confirm the operation.

The items then appear in **Scrapped**, which is read-only.

### Issue goods to another service

1. In Main Inventory, select the relevant items.
2. Start **Goods issued to other services**.
3. Enter the **ΓΕΝ.32Α** reference, date and receiving service name.
4. Review the details and confirm.

**Important:** Lifecycle transitions cannot be undone. When an item leaves Main Inventory for scrapping or issue to another service, employee assignments, location, PC Name, IP and SOCKET are cleared. The original item code and historical information are retained.

## Employees

The Employees page maintains the people who can be assigned equipment.

Administrators and Inventory Managers can add, rename and delete employees, search by name or Employee ID, sort the list and view each employee's assigned equipment count. An employee who is still assigned to equipment cannot be deleted; update the assignments first.

Viewers can search and view employee records without changing them. The employee list can be exported to PDF; the export includes all employees in alphabetical order.

## Locations

The Locations page maintains the places where equipment is held.

Administrators and Inventory Managers can add locations with a name and optional notes, edit them, search by name/notes/Location ID, and view the number of inventory items and distinct assigned employees associated with each location. A location that still contains inventory cannot be deleted; move the equipment first.

Viewers have read-only access. Locations can also be created directly from the inventory item creation and editing forms by Administrators and Inventory Managers. The location list can be exported to PDF in alphabetical order.

## Catalogues

Catalogues define the equipment classification used by the Inventory page:

1. **Item Types** — general equipment categories.
2. **Brands** — associated with an item type.
3. **Models** — associated with a brand.

Administrators and Inventory Managers can add, rename and delete catalogue entries. Viewers can browse and search the catalogues. An entry that is still referenced by inventory cannot be deleted; update the affected inventory records first.

## Batch Import

Batch Import is available to Administrators and Inventory Managers. It supports three Excel workflows:

- Inventory items
- Employees
- Locations

For each workflow:

1. Download the relevant Excel template.
2. Keep the supplied column headings and enter the data in the template.
3. Upload the completed workbook.
4. Review the validation results. Existing records and duplicates within the file are identified; correct or exclude rows as needed.
5. Acknowledge the import and start it.
6. Check the corresponding application section and Audit Logs after completion.

The import process validates the data again on the server before committing it. Existing matching employees and locations are not overwritten by an import. Batch Import is intended for initial database population and large data additions.

## PDF exports

### Inventory PDF

From the Inventory page, open **Export** and select **Export inventory (PDF)**. Choose the columns to include. The export reflects the current search, filters and sort order.

### Issue voucher PDF

Open **Export → Export issue voucher (PDF)**. Select both:

- **Issuer** — appears on the left signature block.
- **Signee** — appears on the right signature block.

Choose the columns and generate the PDF. Both people must be selected.

### Employee and Location PDFs

The Employees and Locations pages each provide a PDF export of all records in alphabetical order.

### Audit history PDFs

In Audit Logs, you can export the complete history for a specific inventory item by entering its Item Code, or for an employee by entering their Employee ID. These reports include timestamps, actions, the user who performed each action and human-readable changes. The report language follows the application's selected language.

## Audit Logs

Audit Logs provide a read-only history of changes. The operational categories are:

- Inventory Items
- Employees
- Locations
- Catalogues

Administrators also have the **Security & Accounts** category. Inventory Managers and Viewers cannot access that category.

Select a category, search the current page and expand an event to inspect its details. Use the page controls to browse the history. Audit history is not editable from the application.

## Accounts

The Accounts page is available only to Administrators. Administrators can create accounts, assign roles, activate or deactivate accounts, and reset another user's password.

- Usernames must contain 3–40 characters and may use letters, numbers, dots, hyphens and underscores.
- Passwords must contain **8–32 characters**.
- Users change their own password in Settings.
- Administrators cannot change their own role, deactivate their own account or reset their own password through the Accounts page.

Give each person an individual account. Do not share credentials.

## Settings

All users can open Settings to manage their own account preferences.

- **Application language:** choose Greek or English. The preference is saved to the user profile.
- **Default page after signing in:** choose an available page and save the preference to the user profile. During an active session, the application also remembers the last page visited.
- **Change password:** enter the current password, the new password (8–32 characters) and confirmation, then submit the form.

The **Flush whole database** section is visible only to Administrators.

## Database flush

<sub>Administrator-only destructive operation</sub>

The database flush permanently deletes all inventory items, employee assignments, employees, locations, catalogue entries (item types, brands and models), audit history and all other user accounts. The Administrator performing the operation is preserved as the active Administrator.

The procedure requires the dedicated server-side flush password, the exact confirmation phrase `FLUSH DATABASE`, review of the deletion summary and a final confirmation. The password is stored as a Supabase Edge Function secret; it is not stored in the database or frontend code.

**This action is irreversible.** It does not remove the database schema, migrations or application deployment. Never use it unless a complete data reset is intended and authorised.

## Good practices

- Keep equipment details, assignments and locations accurate.
- Reuse existing employees, locations, item types, brands and models to avoid duplicates.
- Add notes when they help identify or explain a record.
- Check the current search and filters before exporting.
- Review the relevant audit history after important changes or imports.
- Sign out when using a shared computer.
- Contact an Administrator if a page or action is unavailable or an error occurs.

---

*Internal-use documentation for MJPO Inventory. This README follows the structure and operating guidance of the Greek user guide.*
