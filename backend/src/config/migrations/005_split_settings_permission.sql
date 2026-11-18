-- "Ticketing Settings" is now two permissions: Teams and Ticket categories. A role that had Settings keeps both.
UPDATE AMRole SET RolePrivileges = JSON_SET(JSON_REMOVE(RolePrivileges, '$.tkt_settings'), '$.tkt_teams', JSON_EXTRACT(RolePrivileges, '$.tkt_settings'), '$.tkt_categories', JSON_EXTRACT(RolePrivileges, '$.tkt_settings'))
  WHERE RolePrivileges IS NOT NULL AND RolePrivileges <> '' AND JSON_VALID(RolePrivileges) AND JSON_CONTAINS_PATH(RolePrivileges, 'one', '$.tkt_settings');
