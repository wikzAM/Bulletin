import { describe, expect, it } from "vitest";
import { TodoStore } from "../src/todos";

describe("TodoStore", () => {
  it("adds and lists todos", () => {
    const store = new TodoStore();
    store.add("  write the spec ");
    store.add("build it");
    expect(store.list()).toEqual([
      { id: 1, title: "write the spec", done: false },
      { id: 2, title: "build it", done: false },
    ]);
  });

  it("rejects an empty title", () => {
    expect(() => new TodoStore().add("   ")).toThrow("title is required");
  });

  it("completes and removes todos", () => {
    const store = new TodoStore();
    const { id } = store.add("ship");
    expect(store.complete(id).done).toBe(true);
    store.remove(id);
    expect(store.list()).toEqual([]);
    expect(() => store.remove(id)).toThrow("not found");
  });
});
