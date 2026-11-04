# Development URLs that survived the move

Two references point at the machine of whoever opens the page: a live reload
script on `localhost:3000` and a hero image on `127.0.0.1:8080`. They work
perfectly for the developer who wrote them, which is why they get committed, and
they work on the staging box if the same tooling runs there.

They are not mixed content. Browsers treat a loopback origin as potentially
trustworthy, so neither reference is blocked, upgraded, or reported in the
console warning that catches the rest of this class of problem. The page simply
fails to load those two resources for every visitor, quietly, with no error
anywhere a mixed content audit looks.

That is also why they get the reason they do rather than being folded into the
http findings. The next action is not to obtain a certificate for localhost. It
is to delete the reference.

Raises `MIX008`.

Corrected by removing the reload script and pointing the image back at a path on
the site.
