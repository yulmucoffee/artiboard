-- billing schema: a comment that says create table fake (id int) must not make a symbol
\i sql/extensions.sql
\ir sql/types.sql
source legacy/mysql_init.sql;

/* create table ghost (id int);
   create function fake_fn() returns int */

create schema if not exists billing;

create type billing.money_amount as (cents bigint, currency char(3));

create table if not exists billing.customers (
    id          bigserial primary key,
    email       varchar(255) not null unique,
    note        text default 'create table fake (x int)',
    created_at  timestamptz not null default now()
);

create table billing.invoices (
    id           bigserial primary key,
    customer_id  bigint not null references billing.customers(id) on delete cascade,
    total        numeric(12, 2) not null check (total >= 0),
    issued_on    date not null default current_date,
    constraint invoices_total_pos check (total >= 0)
);

create index if not exists invoices_customer_idx on billing.invoices (customer_id);
create unique index invoices_number_idx on billing.invoices (id);

create view billing.open_invoices as
    select i.id, i.total, c.email
    from billing.invoices i
    join billing.customers c on c.id = i.customer_id
    where i.total > 0;

create or replace function billing.total_for(cust bigint) returns numeric
language sql as $$
    select coalesce(sum(total), 0) from billing.invoices where customer_id = cust;
$$;

create or replace procedure billing.close_month()
language plpgsql as $$
begin
    update billing.invoices set total = total where false;
end;
$$;

create trigger invoices_audit
    after insert or update on billing.invoices
    for each row execute function billing.audit_row();

insert into billing.customers (email) values ('a@example.com');
update billing.customers set note = 'x' where id = 1;
delete from billing.invoices where total = 0;
alter table billing.invoices add column paid_on date;
select count(*), max(total) from billing.open_invoices;
