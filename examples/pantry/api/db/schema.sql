-- Amounts are stored as read (amount, unit) next to the line as written, so the shopping list adds them up without
-- parsing again. Times a phone sets (updated_at) are its clock in milliseconds; the later edit wins.

-- a household is the household_id its members share; whoever made it is its owner
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  household_id uuid NOT NULL DEFAULT gen_random_uuid(),
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  push_token text
);

-- one-time sign-in links (kind 'link') and the sessions they turn into (kind 'session')
CREATE TABLE sign_ins (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('link', 'session')),
  expires_at timestamptz NOT NULL
);

CREATE TABLE recipes (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  title text NOT NULL,
  photo text,
  servings int NOT NULL CHECK (servings > 0),
  minutes int NOT NULL DEFAULT 0,
  ingredients text[] NOT NULL,
  steps text[] NOT NULL,
  kcal int NOT NULL DEFAULT 0, protein int NOT NULL DEFAULT 0, -- per serving, protein in grams
  created_at timestamptz NOT NULL
);

CREATE TABLE ingredients (
  recipe_id uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  position int NOT NULL,
  line text NOT NULL, amount numeric, unit text,
  PRIMARY KEY (recipe_id, position)
);

CREATE TABLE shopping_items (
  household_id uuid NOT NULL, list_id text NOT NULL, id text NOT NULL, name text NOT NULL,
  quantity jsonb, checked boolean NOT NULL DEFAULT false, updated_at bigint NOT NULL,
  PRIMARY KEY (household_id, list_id, id)
);
