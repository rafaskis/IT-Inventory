# IT-Inventory

IT-Inventory is an internal IT equipment management system. It provides a central place to register equipment, associate it with employees and locations, maintain equipment catalogues, and review changes made in the system.

## Getting started

1. Open the IT-Inventory application using the web address provided by your administrator.
2. Enter the username and password supplied by your administrator.
3. Select **Sign in**.

There is no public self-registration. If you need an account, contact an application administrator.

After signing in, the application opens on your Dashboard (or on the default page you have selected in Settings).

## User roles

The pages and actions available to you depend on your assigned role.

| Role | Access |
|---|---|
| **Viewer** | View the Dashboard and Inventory. Use search and filters. Cannot create or edit inventory records or manage reference data. |
| **Inventory Manager** | Viewer access, plus create and edit inventory items; manage employees, locations and catalogues; view operational audit history. |
| **Administrator** | Full application access, including account management and Security & Accounts audit history. |

If you need additional access, contact an administrator. Users cannot change their own role.

## Navigation and common controls

The main navigation is on the left side of the application. On smaller screens, use the menu button in the header to open it.

- **Global Search:** Select the magnifying-glass button in the header or press `Ctrl+K`. Enter at least two characters to search inventory identifiers, employee names, locations and catalogue entries. Select a result to open its corresponding page.
- **Refresh:** Pages that provide a Refresh button can use it to reload their records.
- **Sign out:** Use the Sign out control at the bottom of the navigation panel when you finish.

## Dashboard

The Dashboard provides a quick overview of the registered equipment:

- **Total Equipment** shows the number of inventory items currently registered.
- **Recent Inventory** lists recently registered equipment, including its item code, equipment details, serial number, assigned user and location.
- Use **Refresh** to reload the overview, or **View Inventory** to open the full inventory list.

## Inventory

The Inventory page is the main equipment register.

### Find equipment

- Use the search field to search item codes, serial numbers, MAC addresses, PC names, IP addresses, invoice references, store, EOASIS document numbers and notes.
- Open **Filters** to narrow results by item type, brand, model, employee or location.
- You can also filter by purchase-date and warranty-date ranges.
- Use **Hide shared items?** to hide shared equipment from the results.
- Select **Clear all** to remove the current search and filters.
- Select column headings to sort where sorting is available.
- Use the column selector to show or hide columns. **Reset** restores the default columns.
- Choose the number of rows per page and use the page controls to move through results.

### Add equipment

Users with Inventory Manager or Administrator access can select **Add Inventory Item**.

Complete the required fields:

- Item Type
- Brand
- Model
- Location

The form also supports optional equipment information, where applicable:

- Serial number (optional)
- MAC address, PC name, IP address and socket
- EOASIS document number and invoice
- Purchase date, warranty date and store
- Employee assignments and notes

You can select existing employees or add new employee names while creating an item. New item types, brands, models and locations can also be entered from the item form when needed. The application generates the item code.

Review the information and select **Create Item** to save it.

### Edit equipment

Users with Inventory Manager or Administrator access can select the edit icon beside an inventory item. Update the required information and select **Save Changes**.

### Bulk edit

To update multiple items:

1. Select the checkboxes beside the relevant inventory items.
2. If available, use **Select all matching items** to select all results matching the current search and filters (this option is available for result sets of up to 500 items).
3. Select **Bulk edit**.
4. Review the selected items and choose which fields to update.
5. Apply the changes.

Only fields selected for bulk update are changed; unselected fields remain untouched. Employee assignments selected in a bulk update replace the existing assignments on the selected items.

### Export PDF documents

Two PDF export options are available:

- **Export Inventory PDF:** Creates a standard inventory PDF.
- **Export Issue Voucher:** Creates an issue voucher. Select the employee who will appear in the signature area.

Both exports include all items matching the current search, filters and sort order. Choose the columns to include before generating the PDF.

## Employees

The Employees page maintains the employee list used for equipment assignments.

Users with Inventory Manager or Administrator access can:

- Add an employee by entering their full name.
- Search employees by name or employee ID.
- Sort the list by name or ID.
- Rename an employee.
- View the number of inventory items assigned to an employee.
- Delete an employee when they are no longer needed and have no assigned inventory.

An employee who is still assigned to equipment cannot be deleted. Reassign or remove the equipment assignment first.

## Locations

The Locations page maintains the locations where equipment is held.

Users with Inventory Manager or Administrator access can:

- Add a location with a name and optional notes.
- Search locations by name, notes or location ID.
- Edit a location's name and notes.
- View the number of inventory items and distinct assigned employees associated with a location.
- Delete a location when it has no assigned inventory.

A location that still contains inventory cannot be deleted. Move the equipment to another location first.

## Catalogues

Catalogues define the equipment classification used by the Inventory page. The catalogue hierarchy is:

1. **Item Types** — for example, the general type of equipment.
2. **Brands** — associated with an item type.
3. **Models** — associated with a brand.

Users with Inventory Manager or Administrator access can add, rename and delete catalogue entries. Select the parent item type when managing brands, and select the parent item type and brand when managing models.

The catalogue list shows how many inventory items use each entry. An entry that is still referenced by inventory cannot be deleted. Update the affected inventory records first.

## Audit Logs

Audit Logs provide a read-only history of changes recorded by the application.

- **Inventory Items**, **Employees**, **Locations** and **Catalogues** show operational history.
- **Security & Accounts** is available only to Administrators and contains account/security-related events.
- Select an event to expand it and inspect the recorded changes and additional details.
- Use the search field to search the events on the current page.
- Use the page controls to browse the history.
- In the Inventory Items category, enter an item code and select **Download TXT** to download that item's complete audit history.

Audit history is intended for review and is not editable from the application.

## Accounts

The Accounts page is available only to Administrators.

Administrators can:

- Create an account with a username, temporary password and role.
- Change another user's role.
- Activate or deactivate an account.
- Reset another user's password.
- Refresh the account list.

Usernames must be 3–40 characters and may contain letters, numbers, dots, hyphens and underscores. Passwords must contain 12–128 characters.

Administrators cannot change their own role, deactivate their own account or reset their own password from the Accounts page. To change your own password, use **Settings**.

Give each person their own account. Do not share usernames or passwords.

## Settings

Select **Settings** at the bottom of the navigation panel.

### Change your password

1. Enter your current password.
2. Enter a new password (12–128 characters).
3. Confirm the new password.
4. Select **Change password**.

The current password must be verified, and the new password must differ from it.

### Choose your default page

Use **Default page after signing in** to select the page that should open when you sign in, then select **Save preference**. This preference is stored in the current browser for your account. During an active session, the application also remembers the last page you visited.

## Good practices

- Keep equipment details accurate and update assignments and locations when equipment moves between employees or sites.
- Use the existing item types, brands, models, employees and locations where possible instead of creating duplicates.
- Add notes when they help identify or explain an equipment record.
- Check the current search and filters before exporting, because exports include the matching results.
- Sign out when using a shared computer.
- Report unexpected errors or access problems to the application administrator.

---

*IT-Inventory is currently being introduced on a trial basis. Available features and procedures may change as the application develops.*
