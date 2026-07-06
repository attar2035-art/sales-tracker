-- جدول بيانات العملاء السنوية (المسحوبات)
CREATE TABLE IF NOT EXISTS customer_yearly_sales (
  id BIGSERIAL PRIMARY KEY,
  customer_code TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  region_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  net_sales DECIMAL DEFAULT 0,
  collected DECIMAL DEFAULT 0,
  aging_0_30 DECIMAL DEFAULT 0,
  aging_31_60 DECIMAL DEFAULT 0,
  aging_61_90 DECIMAL DEFAULT 0,
  aging_91_120 DECIMAL DEFAULT 0,
  aging_120_plus DECIMAL DEFAULT 0,
  debt_age TEXT,
  monthly_avg_collection DECIMAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_code, year, region_name)
);

DO $$
BEGIN
  ALTER TABLE customer_yearly_sales
    DROP CONSTRAINT IF EXISTS customer_yearly_sales_customer_code_year_key;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_yearly_sales_customer_code_year_region_name_key'
  ) THEN
    ALTER TABLE customer_yearly_sales
      ADD CONSTRAINT customer_yearly_sales_customer_code_year_region_name_key
      UNIQUE (customer_code, year, region_name);
  END IF;
END $$;

ALTER TABLE customer_yearly_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated full access" ON customer_yearly_sales
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
