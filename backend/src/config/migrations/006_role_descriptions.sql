-- The starting roles talk about categories, not ticket types.
UPDATE AMRole SET RoleDescription = 'Sets up roles, users, teams and ticket categories; sees everything' WHERE UserType = 'SUPER_ADMIN' AND RoleDescription LIKE '%ticket types%';
