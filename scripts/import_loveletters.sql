-- Import manually-captured love letters (Virgi + Levi). Idempotent.
CREATE TABLE IF NOT EXISTS love_letters (
  letter_id TEXT PRIMARY KEY,
  member_uuid TEXT,
  member_username TEXT,
  member_name TEXT,
  slug TEXT,
  recipient_name TEXT,
  recipient_username TEXT,
  recipient_uuid TEXT,
  rank INTEGER,
  rank_label TEXT,
  message TEXT,
  created_at INTEGER
);
BEGIN;
INSERT OR IGNORE INTO love_letters (letter_id, member_uuid, member_username, member_name, slug, recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at) VALUES ('47d26642-231f-4dcc-9edd-c9d761049e22', '147e83c8-f3ac-4680-9141-2f518b4b7810', 'jkt48_virgi', 'Virgi JKT48', 'ayo-ngobrol-bareng-260627224024', 'sahiraa .', 'als-9xzm7zfbz48ig6r', 'f21e002a-3fa2-43b7-a62c-1b3fd86d1a28', 3, 'Top Gifter #3', 'maakasih ka sahira gimana kabarnya??, jaga kesehatan ya', 1782580751);
INSERT OR IGNORE INTO love_letters (letter_id, member_uuid, member_username, member_name, slug, recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at) VALUES ('8334d196-2d2b-419f-a53c-6aceecfeb81e', '147e83c8-f3ac-4680-9141-2f518b4b7810', 'jkt48_virgi', 'Virgi JKT48', 'ayo-ngobrol-bareng-260627224024', 'alya nenek virgi only', 'aly-2mgz5z44i31paq', '7aff90ba-3176-49a4-81ed-ba1a5e549800', 2, 'Top Gifter #2', 'woi bocil makasih, nabung plise', 1782580767);
INSERT OR IGNORE INTO love_letters (letter_id, member_uuid, member_username, member_name, slug, recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at) VALUES ('8dfeec8a-0b72-47fe-8eba-ceeb5a320551', '147e83c8-f3ac-4680-9141-2f518b4b7810', 'jkt48_virgi', 'Virgi JKT48', 'ayo-ngobrol-bareng-260627224024', 'Arya Sutanto', 'ary.z8qpof7fbddudix', 'a6818f9b-672c-4dd4-86c7-9768d04c312a', 1, 'Top Gifter #1', 'xiexie gege yaya hahah cie happy graduation yeashhh keren amay', 1782580802);
INSERT OR IGNORE INTO love_letters (letter_id, member_uuid, member_username, member_name, slug, recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at) VALUES ('bc86bed9-04f9-400f-8383-7832e4e772b3', '35d8f1d5-fd07-4109-9ec5-d202f4baf3c1', 'jkt48_levi', 'Levi JKT48', 'hai-260627235347', 'Jekyyy yy', 'zak_27dk71t', 'f7ee54ee-67a9-4d8b-829b-d2e748148701', 3, 'Top Gifter #3', 'ka jeky kapan kita ketemu lagiiii ((', 1782583058);
INSERT OR IGNORE INTO love_letters (letter_id, member_uuid, member_username, member_name, slug, recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at) VALUES ('6b05abb5-b21d-4fea-aebb-07e889a0c11b', '35d8f1d5-fd07-4109-9ec5-d202f4baf3c1', 'jkt48_levi', 'Levi JKT48', 'hai-260627235347', 'Vermak Levia', 'ver-nab', 'e0fc6c42-50ed-456d-959f-0bd041353b9e', 2, 'Top Gifter #2', 'cepet ngeditnya aku mau liat atau aku aj yg edit', 1782583078);
INSERT OR IGNORE INTO love_letters (letter_id, member_uuid, member_username, member_name, slug, recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at) VALUES ('c3563fb7-7cd7-413a-92ba-352a3a6d050a', '35d8f1d5-fd07-4109-9ec5-d202f4baf3c1', 'jkt48_levi', 'Levi JKT48', 'hai-260627235347', 'IBAM M', 'moc-cx', 'e4f82dcc-5407-4f8e-a140-10b6cda0991e', 3, 'Top Gifter #3', 'ka ibam kapan ke indo aku mau oleh oleh', 1782583110);
INSERT OR IGNORE INTO love_letters (letter_id, member_uuid, member_username, member_name, slug, recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at) VALUES ('957daeee-d208-492c-824c-ce5693b982c8', '35d8f1d5-fd07-4109-9ec5-d202f4baf3c1', 'jkt48_levi', 'Levi JKT48', 'hai-260627235347', 'steffff .', 'ste.b1ovlqel526pm', '7817cc26-5347-4685-bc3a-565a1b9c7c68', 1, 'Top Gifter #1', 'ka steff jangan malu malu jd yes or no', 1782583156);
COMMIT;
