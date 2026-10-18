import { type SQL, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import type { ReportQuery } from "./admin.schemas.ts";

// Reports are written in plain SQL with CTEs ("WITH name AS (...)"): each CTE is one
// small, named step, which reads better than one huge nested query.
//
// Revenue rule: a cancelled reservation is treated as fully refunded, so it does NOT
// count. Only ACTIVE reservation_seats rows are tickets sold. Cancellations are
// reported separately so that information isn't lost.

// Optional time filter on the showtime's start: from inclusive, to exclusive.
// The dates are sent as query parameters ($1, $2), never pasted into the SQL text.
function startsAtFilter(column: SQL, { from, to }: ReportQuery) {
  const parts = [sql`true`];
  if (from) parts.push(sql`${column} >= ${from}`);
  if (to) parts.push(sql`${column} < ${to}`);
  return sql.join(parts, sql` and `);
}

// Postgres returns COUNT and SUM as bigint, which node-postgres gives us as a
// STRING (a JS number can't hold every bigint exactly). Our totals fit easily, so
// we convert them. Number.MAX_SAFE_INTEGER cents is about 90 trillion dollars.
const num = (value: unknown) => Number(value);

// Occupancy as a percentage with one decimal; 0 when there are no seats.
const percent = (sold: number, capacity: number) =>
  capacity === 0 ? 0 : Math.round((sold / capacity) * 1000) / 10;

type ShowtimeReportRow = {
  id: number;
  // A string like "2026-10-19 14:00:00+00": Drizzle has node-postgres return
  // timestamps as text and converts them itself, but only for typed queries,
  // not for raw db.execute(). So we convert it below.
  starts_at: string;
  movie_id: number;
  movie_title: string;
  hall_id: number;
  hall_name: string;
  capacity: string;
  tickets_sold: string;
  revenue_cents: string;
  cancelled_reservations: string;
};

export async function showtimesReport(query: ReportQuery) {
  const { rows } = await db.execute<ShowtimeReportRow>(sql`
    with
      -- Step 1: how many seats each hall has.
      capacity as (
        select hall_id, count(*) as seats
        from seats
        group by hall_id
      ),
      -- Step 2: tickets sold and revenue per showtime (active seats only).
      sold as (
        select showtime_id, count(*) as tickets, sum(price_cents) as revenue
        from reservation_seats
        where active
        group by showtime_id
      ),
      -- Step 3: cancelled reservations per showtime, reported but not counted as revenue.
      cancelled as (
        select showtime_id, count(*) as reservations
        from reservations
        where status = 'cancelled'
        group by showtime_id
      )
    select
      s.id, s.starts_at,
      m.id as movie_id, m.title as movie_title,
      h.id as hall_id, h.name as hall_name,
      c.seats as capacity,
      -- LEFT JOIN gives NULL for showtimes with no sales; COALESCE turns that into 0.
      coalesce(sold.tickets, 0) as tickets_sold,
      coalesce(sold.revenue, 0) as revenue_cents,
      coalesce(cancelled.reservations, 0) as cancelled_reservations
    from showtimes s
    join movies m on m.id = s.movie_id
    join halls h on h.id = s.hall_id
    join capacity c on c.hall_id = s.hall_id
    left join sold on sold.showtime_id = s.id
    left join cancelled on cancelled.showtime_id = s.id
    where ${startsAtFilter(sql`s.starts_at`, query)}
    order by s.starts_at, s.id
  `);

  const showtimes = rows.map((r) => {
    const capacity = num(r.capacity);
    const ticketsSold = num(r.tickets_sold);
    return {
      id: r.id,
      startsAt: new Date(r.starts_at),
      movie: { id: r.movie_id, title: r.movie_title },
      hall: { id: r.hall_id, name: r.hall_name },
      capacity,
      ticketsSold,
      occupancyPct: percent(ticketsSold, capacity),
      revenueCents: num(r.revenue_cents),
      cancelledReservations: num(r.cancelled_reservations),
    };
  });

  const capacity = showtimes.reduce((sum, s) => sum + s.capacity, 0);
  const ticketsSold = showtimes.reduce((sum, s) => sum + s.ticketsSold, 0);
  return {
    range: { from: query.from ?? null, to: query.to ?? null },
    totals: {
      showtimes: showtimes.length,
      capacity,
      ticketsSold,
      occupancyPct: percent(ticketsSold, capacity),
      revenueCents: showtimes.reduce((sum, s) => sum + s.revenueCents, 0),
      cancelledReservations: showtimes.reduce((sum, s) => sum + s.cancelledReservations, 0),
    },
    showtimes,
  };
}

type MovieReportRow = {
  id: number;
  title: string;
  showtimes: string;
  capacity: string;
  tickets_sold: string;
  revenue_cents: string;
};

export async function moviesReport(query: ReportQuery) {
  const { rows } = await db.execute<MovieReportRow>(sql`
    with
      capacity as (
        select hall_id, count(*) as seats
        from seats
        group by hall_id
      ),
      -- The same "sold" step as the showtimes report, so both count tickets the same way.
      sold as (
        select showtime_id, count(*) as tickets, sum(price_cents) as revenue
        from reservation_seats
        where active
        group by showtime_id
      ),
      -- One row per showtime in the range, with its capacity and sales.
      per_showtime as (
        select
          s.id, s.movie_id, c.seats as capacity,
          coalesce(sold.tickets, 0) as tickets,
          coalesce(sold.revenue, 0) as revenue
        from showtimes s
        join capacity c on c.hall_id = s.hall_id
        left join sold on sold.showtime_id = s.id
        where ${startsAtFilter(sql`s.starts_at`, query)}
      )
    -- Starting FROM movies with a LEFT JOIN keeps movies that had no showtimes
    -- in the range: they appear with zeros instead of disappearing.
    select
      m.id, m.title,
      count(p.id) as showtimes,
      coalesce(sum(p.capacity), 0) as capacity,
      coalesce(sum(p.tickets), 0) as tickets_sold,
      coalesce(sum(p.revenue), 0) as revenue_cents
    from movies m
    left join per_showtime p on p.movie_id = m.id
    group by m.id, m.title
    order by revenue_cents desc, m.title
  `);

  const movies = rows.map((r) => {
    const capacity = num(r.capacity);
    const ticketsSold = num(r.tickets_sold);
    return {
      id: r.id,
      title: r.title,
      showtimes: num(r.showtimes),
      capacity,
      ticketsSold,
      occupancyPct: percent(ticketsSold, capacity),
      revenueCents: num(r.revenue_cents),
    };
  });

  return {
    range: { from: query.from ?? null, to: query.to ?? null },
    totals: {
      ticketsSold: movies.reduce((sum, m) => sum + m.ticketsSold, 0),
      revenueCents: movies.reduce((sum, m) => sum + m.revenueCents, 0),
    },
    movies,
  };
}
