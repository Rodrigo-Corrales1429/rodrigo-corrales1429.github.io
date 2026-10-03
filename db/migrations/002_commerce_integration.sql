-- Aditiva: no importa RAM ni modifica existencias. Cutover y carga inicial explícitos.
ALTER TABLE orders ADD COLUMN shipping_quote jsonb;
ALTER TABLE orders ADD CONSTRAINT orders_buyer_bounds CHECK (
  (buyer_name IS NULL OR length(buyer_name) <= 80) AND
  (buyer_email IS NULL OR length(buyer_email) <= 160) AND
  (buyer_phone IS NULL OR length(buyer_phone) <= 24));
ALTER TABLE payment_attempts ADD COLUMN expires_at timestamptz;
ALTER TABLE payments ADD COLUMN method_type text CHECK (length(method_type) <= 40);
ALTER TABLE outbox ADD COLUMN payment_event_id uuid REFERENCES payment_events(id);
ALTER TABLE outbox ADD COLUMN event_data jsonb NOT NULL DEFAULT '{}';
ALTER TABLE outbox DROP CONSTRAINT outbox_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_one_entity CHECK (
  num_nonnulls(order_id, lead_id, payment_event_id) = 1);
CREATE INDEX payment_attempts_fingerprint ON payment_attempts(request_fingerprint);
