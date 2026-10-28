alter table public.messages
  drop constraint if exists messages_voice_note_metadata_check;

alter table public.messages
  drop column if exists voice_duration_ms,
  drop column if exists voice_waveform;
