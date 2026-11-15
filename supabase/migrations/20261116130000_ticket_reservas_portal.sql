-- =====================================================================
-- TIXFAST · RESERVADOS VIP DENTRO DEL PORTAL DE ENTRADAS
-- ---------------------------------------------------------------------
-- La página pública de un evento (/e/<enlace>) muestra, abajo del todo, el bloque desplegable
-- de reservados VIP (plano en directo, mesas, packs, botellas, datos y pago del adelanto)
-- cuando el organizador tiene activada la reserva online de ese evento.
-- Esta función solo dice SI hay reserva online y con qué enlace: todo lo demás lo sirve
-- reservas_publico(token), que ya es pública y no enseña datos de clientes.
-- =====================================================================
create or replace function public.reservas_de_evento(p_slug text)
returns uuid language sql stable security definer set search_path = '' as $$
  select w.token
  from public.ticket_web_eventos f
  join public.ticket_reservas_web w on w.evento_id = f.evento_id and w.activo
  where f.slug = lower(btrim(p_slug))
    and (f.estado <> 'borrador' or f.owner_id = (select auth.uid()))
  limit 1;
$$;
revoke all on function public.reservas_de_evento(text) from public;
grant execute on function public.reservas_de_evento(text) to anon, authenticated;
