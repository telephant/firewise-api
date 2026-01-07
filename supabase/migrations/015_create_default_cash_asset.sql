-- =====================================================
-- Default Cash Asset on User Registration
-- =====================================================
-- Automatically creates a "Primary Account" cash asset
-- when a new user registers, ensuring salary flows work

-- Step 1: Unique constraint - only one cash asset per user
CREATE UNIQUE INDEX idx_assets_user_cash_unique
ON public.assets (user_id)
WHERE type = 'cash';

-- Step 2: Function to create default cash asset
CREATE OR REPLACE FUNCTION public.create_default_cash_asset()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert default cash asset for new user
  INSERT INTO public.assets (user_id, name, type, currency)
  VALUES (NEW.id, 'Primary Account', 'cash', 'USD')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Trigger after profile creation
CREATE TRIGGER on_profile_created_create_asset
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_cash_asset();

-- Step 4: Backfill existing users who don't have a cash asset
INSERT INTO public.assets (user_id, name, type, currency)
SELECT p.id, 'Primary Account', 'cash', 'USD'
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.assets a
  WHERE a.user_id = p.id AND a.type = 'cash'
)
ON CONFLICT DO NOTHING;
