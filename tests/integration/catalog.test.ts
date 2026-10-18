import { beforeEach, describe, expect, it } from "vitest";
import { adminToken, api, bearer } from "./helpers.ts";

// Phase 2: genres and movies CRUD, validation and the error format.

let admin: string;
beforeEach(async () => {
  admin = await adminToken();
});

describe("genres", () => {
  it("lists genres sorted by name", async () => {
    const res = await api().get("/genres").expect(200);
    expect(res.body.map((g: { name: string }) => g.name)).toEqual(["Action", "Animation", "Comedy", "Drama", "Sci-Fi"]);
  });

  it("creates a genre with a trimmed name, and rejects duplicates with 409", async () => {
    const res = await api().post("/genres").set(bearer(admin)).send({ name: "  Thriller " }).expect(201);
    expect(res.body).toEqual({ id: 6, name: "Thriller" });

    const dup = await api().post("/genres").set(bearer(admin)).send({ name: "Thriller" }).expect(409);
    expect(dup.body.error.code).toBe("GENRE_EXISTS");
  });

  it("rejects unknown keys", async () => {
    const res = await api().post("/genres").set(bearer(admin)).send({ nmae: "X" }).expect(400);
    expect(res.body.error.details).toContainEqual({ path: "body", message: 'Unrecognized key: "nmae"' });
  });
});

describe("movies", () => {
  it("lists movies with genres and pagination", async () => {
    const res = await api().get("/movies?limit=2").expect(200);
    expect(res.body.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(res.body.data[0]).toMatchObject({
      title: "Inception",
      genres: [{ name: "Action" }, { name: "Sci-Fi" }],
    });
  });

  it("filters by genre", async () => {
    const res = await api().get("/movies?genre=5").expect(200); // 5 = Animation
    expect(res.body.data.map((m: { title: string }) => m.title)).toEqual(["Spirited Away"]);
  });

  it("creates, reads, updates and deletes a movie", async () => {
    const created = await api()
      .post("/movies")
      .set(bearer(admin))
      .send({ title: "Arrival", description: "Aliens arrive.", durationMinutes: 116, genreIds: [4, 3, 4] })
      .expect(201);
    expect(created.headers.location).toBe(`/movies/${created.body.id}`);
    expect(created.body.genres.map((g: { id: number }) => g.id).sort()).toEqual([3, 4]);

    const id = created.body.id;
    await api().get(`/movies/${id}`).expect(200);

    const updated = await api().patch(`/movies/${id}`).set(bearer(admin)).send({ title: "Arrival (2016)", genreIds: [4] }).expect(200);
    expect(updated.body).toMatchObject({ title: "Arrival (2016)", description: "Aliens arrive.", genres: [{ id: 4 }] });

    await api().delete(`/movies/${id}`).set(bearer(admin)).expect(204);
    await api().get(`/movies/${id}`).expect(404);
  });

  it("reports every validation problem at once", async () => {
    const res = await api()
      .post("/movies")
      .set(bearer(admin))
      .send({ title: "", durationMinutes: -5, posterUrl: "javascript:alert(1)" })
      .expect(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["body.title", "body.description", "body.posterUrl", "body.durationMinutes"]));
  });

  it("names unknown genre ids", async () => {
    const res = await api()
      .post("/movies")
      .set(bearer(admin))
      .send({ title: "X", description: "Y", durationMinutes: 90, genreIds: [1, 99] })
      .expect(400);
    expect(res.body.error.details[0].message).toBe("Unknown genre id(s): 99");
  });

  it("refuses to delete a movie that has showtimes", async () => {
    const res = await api().delete("/movies/1").set(bearer(admin)).expect(409);
    expect(res.body.error.code).toBe("MOVIE_HAS_SHOWTIMES");
  });
});

describe("error format", () => {
  it("returns JSON for malformed bodies, bad ids and unknown routes", async () => {
    const badJson = await api().post("/movies").set(bearer(admin)).set("Content-Type", "application/json").send('{"title":').expect(400);
    expect(badJson.body.error.code).toBe("INVALID_JSON");

    await api().get("/movies/abc").expect(400);
    const missing = await api().get("/movies/999").expect(404);
    expect(missing.body).toEqual({ error: { code: "NOT_FOUND", message: "Movie 999 not found" } });

    const route = await api().get("/nope").expect(404);
    expect(route.body.error.code).toBe("NOT_FOUND");
  });
});
