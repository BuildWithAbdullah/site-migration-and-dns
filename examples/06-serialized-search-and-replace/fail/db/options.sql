-- An options extract after a plain text search and replace.
-- The strings changed. The byte lengths in front of them did not.
INSERT INTO wp_options (option_name, option_value) VALUES
('widget_recent_posts', 'a:2:{s:5:"title";s:12:"Recent posts";s:4:"link";s:33:"https://www.example.org/blog";}'),
('theme_mods_slider', 'a:1:{s:6:"slides";a:2:{i:0;s:43:"https://www.example.org/images/one.jpg";i:1;s:43:"https://www.example.org/images/two.jpg";}}'),
('panel_settings', 'a:2:{s:5:"panel";s:54:"a:1:{s:4:"home";s:29:"https://www.old-site.example/";}";s:7:"version";i:3;}'),
('cache_manifest', 'a:1:{s:4:"keys";a:1:{i:0;s:40:"assets/app.js";}}'),
('siteurl', 'https://www.example.org');
