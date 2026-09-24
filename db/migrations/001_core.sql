-- Fase 2A: esquema aditivo. No conecta ninguna ruta del API actual.
-- UUIDs se generan en la aplicación; BIGINT conserva importes en centavos.

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  folio text NOT NULL UNIQUE CHECK (length(folio) BETWEEN 3 AND 120),
  currency text NOT NULL DEFAULT 'MXN' CHECK (currency = 'MXN'),
  subtotal_centavos bigint NOT NULL CHECK (subtotal_centavos >= 0),
  shipping_centavos bigint NOT NULL CHECK (shipping_centavos >= 0),
  total_centavos bigint NOT NULL CHECK (total_centavos > 0 AND total_centavos = subtotal_centavos + shipping_centavos),
  payment_state text NOT NULL DEFAULT 'pending' CHECK (payment_state IN ('pending','in_process','authorized','approved','rejected','cancelled','refunded','charged_back','review')),
  fulfillment_state text NOT NULL DEFAULT 'unallocated' CHECK (fulfillment_state IN ('unallocated','reserved','allocated','paid_unallocated','fulfilled','review')),
  review_reason text,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  shipping_address jsonb,
  legacy_source_key text UNIQUE,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id uuid NOT NULL REFERENCES orders(id),
  sku text NOT NULL CHECK (length(sku) > 0),
  title text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_centavos bigint NOT NULL CHECK (unit_price_centavos >= 0),
  line_total_centavos bigint NOT NULL CHECK (line_total_centavos >= 0 AND line_total_centavos = quantity * unit_price_centavos),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  idempotency_key_hash text UNIQUE,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  provider_key text NOT NULL UNIQUE CHECK (length(provider_key) > 0),
  preference_id text UNIQUE,
  checkout_url text,
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','creating','ready','uncertain','failed')),
  next_check_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  lease_until timestamptz,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, order_id),
  CHECK (preference_id IS NULL OR length(preference_id) > 0),
  CHECK (idempotency_key_hash IS NULL OR length(idempotency_key_hash) = 64),
  CHECK (state <> 'ready' OR (preference_id IS NOT NULL AND checkout_url IS NOT NULL AND length(checkout_url) > 0))
);

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'mercado_pago' CHECK (provider = 'mercado_pago'),
  provider_payment_id text NOT NULL CHECK (length(provider_payment_id) > 0),
  order_id uuid REFERENCES orders(id),
  attempt_id uuid,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','pending','in_process','authorized','approved','rejected','cancelled','refunded','charged_back')),
  status_detail text,
  amount_centavos bigint CHECK (amount_centavos >= 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  provider_account_id text,
  provider_environment text CHECK (provider_environment IN ('sandbox','production')),
  provider_updated_at timestamptz,
  verified_at timestamptz,
  next_check_at timestamptz,
  lease_until timestamptz,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id),
  FOREIGN KEY (attempt_id, order_id) REFERENCES payment_attempts(id, order_id),
  CHECK (attempt_id IS NULL OR order_id IS NOT NULL),
  CHECK (verified_at IS NULL OR (amount_centavos IS NOT NULL AND currency IS NOT NULL)),
  CHECK (status = 'unknown' OR verified_at IS NOT NULL)
);

CREATE TABLE payment_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'mercado_pago' CHECK (provider = 'mercado_pago'),
  source text NOT NULL CHECK (source IN ('webhook','reconcile')),
  external_event_id text,
  provider_payment_id text NOT NULL CHECK (length(provider_payment_id) > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','applied','duplicate','review','failed')),
  error_code text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  CHECK (external_event_id IS NULL OR length(external_event_id) > 0),
  CHECK ((processed_at IS NULL) = (outcome IN ('pending','failed')))
);
CREATE UNIQUE INDEX payment_events_provider_external_id_unique
  ON payment_events(provider, external_event_id) WHERE external_event_id IS NOT NULL;

CREATE TABLE inventory (
  sku text PRIMARY KEY CHECK (length(sku) > 0),
  on_hand integer NOT NULL CHECK (on_hand >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_reservations (
  order_id uuid NOT NULL,
  sku text NOT NULL REFERENCES inventory(sku),
  quantity integer NOT NULL CHECK (quantity > 0),
  identity_hash text CHECK (identity_hash IS NULL OR length(identity_hash) = 64),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','released','expired','consumed')),
  expires_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, sku),
  FOREIGN KEY (order_id, sku) REFERENCES order_items(order_id, sku),
  CHECK (expires_at > created_at)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,
  sku text NOT NULL REFERENCES inventory(sku),
  order_id uuid REFERENCES orders(id),
  kind text NOT NULL CHECK (kind IN ('baseline','sale','adjustment','return')),
  delta integer NOT NULL CHECK (delta <> 0),
  operation_key text NOT NULL UNIQUE CHECK (length(operation_key) > 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'sale' OR (order_id IS NOT NULL AND delta < 0)),
  CHECK (kind <> 'return' OR delta > 0),
  FOREIGN KEY (order_id, sku) REFERENCES order_items(order_id, sku)
);
CREATE UNIQUE INDEX inventory_one_sale_per_order_sku
  ON inventory_movements(order_id, sku) WHERE kind = 'sale';

CREATE TABLE leads (
  id uuid PRIMARY KEY,
  legacy_source_key text UNIQUE,
  contact_name text,
  contact_phone text,
  contact_email text,
  summary text NOT NULL,
  urgency text,
  state text NOT NULL DEFAULT 'new' CHECK (state IN ('new','contacted','closed','review')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  order_id uuid REFERENCES orders(id),
  lead_id uuid REFERENCES leads(id),
  entity_version bigint NOT NULL CHECK (entity_version > 0),
  event_type text NOT NULL CHECK (length(event_type) > 0),
  channel text NOT NULL CHECK (length(channel) > 0),
  dedupe_key text NOT NULL UNIQUE CHECK (length(dedupe_key) > 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','delivered','failed')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  external_result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((order_id IS NULL) <> (lead_id IS NULL))
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (length(entity_type) > 0),
  entity_id text NOT NULL CHECK (length(entity_id) > 0),
  previous_state text,
  new_state text,
  entity_version bigint CHECK (entity_version IS NULL OR entity_version > 0),
  actor text NOT NULL CHECK (actor IN ('system','import','manual')),
  correlation_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_attempts_due ON payment_attempts(next_check_at) WHERE state IN ('prepared','uncertain');
CREATE INDEX payments_by_order ON payments(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX payments_due ON payments(next_check_at) WHERE next_check_at IS NOT NULL;
CREATE INDEX payment_events_due ON payment_events(next_attempt_at) WHERE outcome IN ('pending','failed');
CREATE INDEX inventory_reservations_active_sku ON inventory_reservations(sku, expires_at) WHERE state = 'active';
CREATE INDEX inventory_reservations_identity ON inventory_reservations(identity_hash) WHERE state = 'active';
CREATE INDEX outbox_due ON outbox(next_attempt_at) WHERE state IN ('pending','failed');
CREATE INDEX audit_events_entity ON audit_events(entity_type, entity_id, created_at);
