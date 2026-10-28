alter table public.messages
  add column if not exists voice_duration_ms integer,
  add column if not exists voice_waveform jsonb;

alter table public.messages
  drop constraint if exists messages_voice_note_metadata_check;

alter table public.messages
  add constraint messages_voice_note_metadata_check check (
    (
      voice_note
      and (
        (voice_duration_ms is null and voice_waveform is null)
        or (
          voice_duration_ms between 1 and 300000
          and jsonb_typeof(voice_waveform) = 'array'
          and jsonb_array_length(voice_waveform) between 1 and 48
        )
      )
    )
    or (
      not voice_note
      and voice_duration_ms is null
      and voice_waveform is null
    )
  );

grant insert (voice_duration_ms, voice_waveform)
  on public.messages to authenticated;
