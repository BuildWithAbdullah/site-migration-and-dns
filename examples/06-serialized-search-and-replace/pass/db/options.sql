-- The same options extract, rewritten with replaceInSerialized.
-- Every length prefix was recomputed, including the nested payload.
INSERT INTO wp_options (option_name, option_value) VALUES
('widget_recent_posts', 'a:2:{s:5:"title";s:12:"Recent posts";s:4:"link";s:28:"https://www.example.org/blog";}'),
('theme_mods_slider', 'a:1:{s:6:"slides";a:2:{i:0;s:38:"https://www.example.org/images/one.jpg";i:1;s:38:"https://www.example.org/images/two.jpg";}}'),
('panel_settings', 'a:2:{s:5:"panel";s:49:"a:1:{s:4:"home";s:24:"https://www.example.org/";}";s:7:"version";i:3;}'),
('siteurl', 'https://www.example.org');
