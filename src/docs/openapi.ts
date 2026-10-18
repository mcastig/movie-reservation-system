import { z } from "zod";
import { paginationQuery } from "../lib/schemas.ts";
import { reportQuery } from "../modules/admin/admin.schemas.ts";
import { loginBody, refreshTokenBody, signupBody } from "../modules/auth/auth.schemas.ts";
import { createGenreBody } from "../modules/genres/genres.schemas.ts";
import { createMovieBody, listMoviesQuery, updateMovieBody } from "../modules/movies/movies.schemas.ts";
import { adminReservationsQuery, createReservationBody } from "../modules/reservations/reservations.schemas.ts";
import { createShowtimeBody, scheduleQuery, updateShowtimeBody } from "../modules/showtimes/showtimes.schemas.ts";
import { setRoleBody } from "../modules/users/users.schemas.ts";

// The OpenAPI document is built from the SAME Zod schemas that validate requests,
// using Zod's built-in z.toJSONSchema(). Change a schema and the docs change with it,
// so they can't drift apart. Paths and descriptions are written here by hand.

// io: "input" describes what a client SENDS (before coercion, trimming and defaults).
function jsonSchema(schema: z.ZodType) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return rest;
}

// Turns a Zod object (like ?page=&limit=) into a list of OpenAPI query parameters.
function queryParameters(schema: z.ZodObject) {
  const { properties = {}, required = [] } = jsonSchema(schema) as {
    properties?: Record<string, object>;
    required?: string[];
  };
  return Object.entries(properties).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema,
  }));
}

const idParameter = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } };
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

type Operation = {
  summary: string;
  tag: string;
  auth?: "user" | "admin";
  id?: boolean;
  query?: z.ZodObject;
  body?: z.ZodType;
  // status → description; 4xx/5xx use the shared Error shape.
  responses: Record<number, string>;
};

function operation({ summary, tag, auth, id, query, body, responses }: Operation) {
  const all: Record<number, string> = { ...responses };
  if (body || query || id) all[400] ??= "Invalid input (see `error.details`)";
  if (auth) all[401] = "Missing, invalid or expired access token";
  if (auth === "admin") all[403] = "Not an admin";

  return {
    summary,
    tags: [tag],
    ...(auth && { security: [{ bearerAuth: [] }] }),
    parameters: [...(id ? [idParameter] : []), ...(query ? queryParameters(query) : [])],
    ...(body && { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(body) } } } }),
    responses: Object.fromEntries(
      Object.entries(all).map(([status, description]) => [
        status,
        Number(status) >= 400 ? errorResponse(description) : { description },
      ]),
    ),
  };
}

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Movie Reservation API",
    version: "0.1.0",
    description:
      "Browse movies and showtimes, book seats, and manage the catalog. " +
      "Log in with `POST /auth/login`, then click **Authorize** and paste the `accessToken`. " +
      "Times are ISO 8601 with a timezone; money is in integer cents.",
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", examples: ["SEATS_TAKEN"] },
              message: { type: "string" },
              details: { type: "array", items: { type: "object" } },
              requestId: { type: "string", description: "Only on 500s: quote it when reporting a problem" },
            },
          },
        },
      },
    },
  },
  paths: {
    "/health": { get: operation({ summary: "Liveness check", tag: "System", responses: { 200: "OK" } }) },

    "/auth/signup": {
      post: operation({ summary: "Create an account (always a regular user)", tag: "Auth", body: signupBody,
        responses: { 201: "The new user", 409: "Email already registered", 429: "Too many attempts" } }),
    },
    "/auth/login": {
      post: operation({ summary: "Log in: returns an access token (15 min) and a refresh token", tag: "Auth", body: loginBody,
        responses: { 200: "Tokens", 401: "Invalid email or password", 429: "Too many attempts" } }),
    },
    "/auth/refresh": {
      post: operation({ summary: "Exchange a refresh token for a new pair (each works once)", tag: "Auth", body: refreshTokenBody,
        responses: { 200: "New tokens", 401: "Invalid, expired or reused refresh token", 429: "Too many attempts" } }),
    },
    "/auth/logout": {
      post: operation({ summary: "Revoke a refresh token", tag: "Auth", body: refreshTokenBody,
        responses: { 204: "Logged out (also for unknown tokens)" } }),
    },
    "/me": { get: operation({ summary: "The current user", tag: "Users", auth: "user", responses: { 200: "The user" } }) },
    "/users/{id}/role": {
      patch: operation({ summary: "Promote or demote a user", tag: "Users", auth: "admin", id: true, body: setRoleBody,
        responses: { 200: "The updated user", 404: "User not found" } }),
    },

    "/genres": {
      get: operation({ summary: "List genres", tag: "Catalog", responses: { 200: "Genres sorted by name" } }),
      post: operation({ summary: "Create a genre", tag: "Catalog", auth: "admin", body: createGenreBody,
        responses: { 201: "The new genre", 409: "Name already exists" } }),
    },
    "/movies": {
      get: operation({ summary: "List movies (paginated, optional genre filter)", tag: "Catalog", query: listMoviesQuery,
        responses: { 200: "{ data, pagination }" } }),
      post: operation({ summary: "Create a movie", tag: "Catalog", auth: "admin", body: createMovieBody,
        responses: { 201: "The new movie" } }),
    },
    "/movies/showtimes": {
      get: operation({ summary: "Movies with their upcoming showtimes on a local day", tag: "Browse", query: scheduleQuery,
        responses: { 200: "{ date, timezone, movies: [...] }" } }),
    },
    "/movies/{id}": {
      get: operation({ summary: "One movie with its genres", tag: "Catalog", id: true, responses: { 200: "The movie", 404: "Not found" } }),
      patch: operation({ summary: "Update some fields (genreIds replaces the list)", tag: "Catalog", auth: "admin", id: true,
        body: updateMovieBody, responses: { 200: "The updated movie", 404: "Not found" } }),
      delete: operation({ summary: "Delete a movie without showtimes", tag: "Catalog", auth: "admin", id: true,
        responses: { 204: "Deleted", 404: "Not found", 409: "The movie has showtimes" } }),
    },

    "/showtimes": {
      post: operation({ summary: "Schedule a showtime (endsAt is computed)", tag: "Showtimes", auth: "admin", body: createShowtimeBody,
        responses: { 201: "The new showtime", 409: "Hall is busy at that time" } }),
    },
    "/showtimes/{id}": {
      get: operation({ summary: "One showtime with its movie and hall", tag: "Showtimes", id: true,
        responses: { 200: "The showtime", 404: "Not found" } }),
      patch: operation({ summary: "Change price (always) or movie, hall, time (only without reservations)", tag: "Showtimes",
        auth: "admin", id: true, body: updateShowtimeBody,
        responses: { 200: "The updated showtime", 404: "Not found", 409: "Busy hall, has reservations, or already started" } }),
      delete: operation({ summary: "Delete a showtime without reservations", tag: "Showtimes", auth: "admin", id: true,
        responses: { 204: "Deleted", 404: "Not found", 409: "The showtime has reservations" } }),
    },
    "/showtimes/{id}/seats": {
      get: operation({ summary: "Seat map: every seat in the hall, with availability", tag: "Browse", id: true,
        responses: { 200: "{ showtime, totalSeats, availableSeats, rows }", 404: "Not found" } }),
    },

    "/reservations": {
      post: operation({ summary: "Book seats (the total is computed on the server)", tag: "Reservations", auth: "user",
        body: createReservationBody,
        responses: { 201: "The reservation", 409: "Seat(s) already taken, or the showtime started" } }),
    },
    "/reservations/me": {
      get: operation({ summary: "My reservations (paginated)", tag: "Reservations", auth: "user", query: paginationQuery,
        responses: { 200: "{ data, pagination }" } }),
    },
    "/reservations/{id}": {
      get: operation({ summary: "One reservation (yours; admins see all)", tag: "Reservations", auth: "user", id: true,
        responses: { 200: "The reservation", 404: "Not found (or not yours)" } }),
    },
    "/reservations/{id}/cancel": {
      post: operation({ summary: "Cancel an upcoming reservation and free its seats", tag: "Reservations", auth: "user", id: true,
        responses: { 200: "The cancelled reservation", 404: "Not found (or not yours)", 409: "Already cancelled or already started" } }),
    },

    "/admin/reservations": {
      get: operation({ summary: "Every reservation, filtered and paginated", tag: "Admin", auth: "admin", query: adminReservationsQuery,
        responses: { 200: "{ data, pagination }" } }),
    },
    "/admin/reports/showtimes": {
      get: operation({ summary: "Per showtime: capacity, tickets sold, occupancy, revenue", tag: "Admin", auth: "admin",
        query: reportQuery, responses: { 200: "{ range, totals, showtimes }" } }),
    },
    "/admin/reports/movies": {
      get: operation({ summary: "Per movie: tickets sold and revenue", tag: "Admin", auth: "admin", query: reportQuery,
        responses: { 200: "{ range, totals, movies }" } }),
    },
  },
};
