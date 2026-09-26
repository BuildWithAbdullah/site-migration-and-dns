-- A small extract of an options table, after a correct migration.
INSERT INTO wp_options (option_name, option_value) VALUES
('widget_recent_posts', 'a:3:{s:5:"title";s:12:"Recent posts";s:5:"count";i:5;s:4:"link";s:28:"https://www.example.org/blog";}'),
('theme_mods_baseline', 'a:2:{s:4:"logo";s:39:"https://www.example.org/images/logo.svg";s:10:"show_title";b:1;}'),
('siteurl', 'https://www.example.org'),
('home', 'https://www.example.org');
