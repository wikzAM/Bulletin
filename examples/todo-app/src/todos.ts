export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

/** A tiny in-memory todo list: the sample target for Bulletin acceptance runs. */
export class TodoStore {
  private todos: Todo[] = [];
  private nextId = 1;

  add(title: string): Todo {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("title is required");
    const todo: Todo = { id: this.nextId++, title: trimmed, done: false };
    this.todos.push(todo);
    return todo;
  }

  list(): Todo[] {
    return this.todos.map((t) => ({ ...t }));
  }

  complete(id: number): Todo {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) throw new Error(`todo ${id} not found`);
    todo.done = true;
    return { ...todo };
  }

  remove(id: number): void {
    const before = this.todos.length;
    this.todos = this.todos.filter((t) => t.id !== id);
    if (this.todos.length === before) throw new Error(`todo ${id} not found`);
  }
}
