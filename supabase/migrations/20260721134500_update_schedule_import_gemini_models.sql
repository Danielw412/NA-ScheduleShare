-- Update Gemini schedule-import models to support gemini-3.5-flash-lite and gemini-3.5-flash.

insert into private.schedule_import_models (
  model_id,
  display_name,
  enabled,
  supports_image_input,
  supports_structured_output,
  supported_thinking_levels,
  max_output_tokens
)
values
  (
    'gemini-3.5-flash-lite',
    'Gemini 3.5 Flash-Lite',
    true,
    true,
    true,
    array['minimal', 'low', 'medium', 'high'],
    65536
  ),
  (
    'gemini-3.5-flash',
    'Gemini 3.5 Flash',
    true,
    true,
    true,
    array['minimal', 'low', 'medium', 'high'],
    65536
  )
on conflict (model_id) do update
set display_name = excluded.display_name,
    enabled = excluded.enabled,
    supports_image_input = excluded.supports_image_input,
    supports_structured_output = excluded.supports_structured_output,
    supported_thinking_levels = excluded.supported_thinking_levels,
    max_output_tokens = excluded.max_output_tokens,
    updated_at = now();

update private.schedule_import_settings
set active_model_id = 'gemini-3.5-flash-lite',
    updated_at = now()
where active_model_id = 'gemini-3.1-flash-lite';
