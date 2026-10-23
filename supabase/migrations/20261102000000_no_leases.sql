-- Leases kept two viewers from linking one person at once (ab_acquire, callable from the browser). The people/ guard
-- in ab_apply now lets a member link only their own person, once, so there is nothing left to race for.
drop function if exists public.ab_acquire(text, text, int);
drop table if exists public.ab_leases;
