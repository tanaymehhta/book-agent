-- Fake data so the Roster column + Band Profile tab has something to render
-- locally. Three approved bands, each with a short email thread + W-9/bio/socials.

BEGIN;

-- Wipe anything stale so the seed is deterministic.
TRUNCATE bands, email_threads, messages, drafts, roster_entries RESTART IDENTITY CASCADE;

WITH new_bands AS (
  INSERT INTO bands (
    name, contact_name, primary_email, status, on_roster, conversation_stage,
    w9_name, bio, social_links,
    first_contact_at, last_activity_at
  ) VALUES
  (
    'The Hollow Pines',
    'Margaret Cole',
    'margaret@hollowpinesband.com',
    'approved', true, 'confirmed',
    'Margaret R. Cole',
    'Four-piece roots band out of Asheville. Tight harmonies, upright bass, a clawhammer banjo that does most of the talking. Their Tiny Desk submission almost broke through last year — they''ve been touring small rooms since.',
    '[
      {"label": "Spotify", "url": "https://open.spotify.com/artist/hollowpines"},
      {"label": "Instagram", "url": "https://instagram.com/hollowpinesband"},
      {"label": "Bandcamp", "url": "https://hollowpines.bandcamp.com"}
    ]'::jsonb,
    now() - interval '21 days',
    now() - interval '2 days'
  ),
  (
    'Sable & The Wash',
    'Devon Sable',
    'booking@sableandthewash.com',
    'approved', true, 'confirmed',
    'Sable Music LLC',
    'Brooklyn-by-way-of-New Orleans sextet. Horn-forward, dance-leaning. They play long sets and bring their own sound engineer, which is rare and lovely.',
    '[
      {"label": "Spotify", "url": "https://open.spotify.com/artist/sableandthewash"},
      {"label": "Instagram", "url": "https://instagram.com/sableandthewash"},
      {"label": "YouTube", "url": "https://youtube.com/@sableandthewash"},
      {"label": "Website", "url": "https://sableandthewash.com"}
    ]'::jsonb,
    now() - interval '34 days',
    now() - interval '5 days'
  ),
  (
    'Junebug Radio',
    'Aman Patel',
    'hello@junebugradio.fm',
    'approved', true, 'confirmed',
    'Junebug Radio',
    'Solo act with a loop pedal and a small army of pedals on the floor. Plays the kind of dusk-falling set that empties the bar onto the patio.',
    '[
      {"label": "Bandcamp", "url": "https://junebugradio.bandcamp.com"},
      {"label": "Instagram", "url": "https://instagram.com/junebugradio"}
    ]'::jsonb,
    now() - interval '12 days',
    now() - interval '1 day'
  )
  RETURNING id, primary_email, name
),
new_threads AS (
  INSERT INTO email_threads (band_id, provider, provider_thread_id, subject, first_message_at, last_message_at)
  SELECT
    nb.id,
    'gmail',
    'fake-thread-' || replace(nb.id::text, '-', ''),
    'Booking inquiry — ' || nb.name,
    now() - interval '21 days',
    now() - interval '2 days'
  FROM new_bands nb
  RETURNING id, band_id
)
INSERT INTO messages (
  thread_id, provider_message_id, internet_message_id, direction,
  from_address, to_addresses, subject, body_text, snippet, sent_at
)
SELECT
  nt.id,
  'fake-msg-in-' || replace(nt.id::text, '-', ''),
  '<fake-' || replace(nt.id::text, '-', '') || '@lookoutfarm.test>',
  'inbound'::message_direction,
  nb.primary_email,
  jsonb_build_array('bookings@lookoutfarm.com'),
  'Booking inquiry — ' || nb.name,
  'Hi Laura,' || E'\n\n' ||
    'We''re routing through Western Mass in mid-September and would love to play the taproom. Headcounts are usually 80–120 for us; we can do two 45-minute sets or one long one, whatever fits.' || E'\n\n' ||
    'Fee range is $700–$1100 depending on the night. Happy to share a tech rider — we''re self-contained otherwise.' || E'\n\n' ||
    'Thanks,' || E'\n' || nb.name
  ,
  'We''re routing through Western Mass in mid-September…',
  now() - interval '3 days'
FROM new_threads nt
JOIN new_bands nb ON nb.id = nt.band_id

UNION ALL

SELECT
  nt.id,
  'fake-msg-out-' || replace(nt.id::text, '-', ''),
  '<reply-' || replace(nt.id::text, '-', '') || '@lookoutfarm.test>',
  'outbound'::message_direction,
  'bookings@lookoutfarm.com',
  jsonb_build_array(nb.primary_email),
  'Re: Booking inquiry — ' || nb.name,
  'Thanks so much for reaching out — we''d love to host you. September 14 or 21 are both open right now. The taproom holds about 95, sound is in-house, and we typically settle on the higher end of your range for weekend nights.' || E'\n\n' ||
    'Want me to pencil one of those dates in while you check the rest of the routing?' || E'\n\n' ||
    '— Laura'
  ,
  'Thanks so much for reaching out — we''d love to host you…',
  now() - interval '2 days'
FROM new_threads nt
JOIN new_bands nb ON nb.id = nt.band_id;

-- Add one Incoming and one In-Conversation band so the other columns aren't
-- empty (these don't need profile data — the toggle is roster-only).
INSERT INTO bands (name, contact_name, primary_email, status, conversation_stage, first_contact_at, last_activity_at)
VALUES
  ('Marble Sky',  'Tess Romano', 'tess@marblesky.fm',   'incoming',        'new_lead',           now() - interval '6 hours', now() - interval '6 hours'),
  ('Cedar & Tin', 'Jordan Lee',  'jordan@cedarandtin.com', 'in_conversation', 'collecting_details', now() - interval '4 days',  now() - interval '14 hours');

COMMIT;

SELECT name, status, on_roster, w9_name, jsonb_array_length(social_links) AS link_count
FROM bands ORDER BY status, name;
