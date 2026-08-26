-- Grants the first admin so the new /admin page has someone who can see it.
update public.users
set role = 'admin'
where id = (select id from auth.users where email = 'shawnpfarmer@gmail.com');
