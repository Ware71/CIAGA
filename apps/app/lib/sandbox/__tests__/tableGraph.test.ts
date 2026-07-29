import { describe, expect, it } from "vitest";
import { applyStepTransform, planCopy, type SchemaGraph } from "@/lib/sandbox/tableGraph";

type Edge = SchemaGraph["fk_edges"][number];

function edge(over: Partial<Edge> & Pick<Edge, "from_table" | "to_table">): Edge {
  return {
    from_columns: [`${over.to_table}_id`],
    to_schema: "public",
    constraint_name: `${over.from_table}_${over.to_table}_fkey`,
    nullable: true,
    is_self: false,
    ...over,
  };
}

function graph(
  tables: Array<string | [string, string[]]>,
  fk_edges: Edge[],
  preserved: string[] = []
): SchemaGraph {
  return {
    tables: tables.map((t) =>
      typeof t === "string" ? { name: t, pk_columns: ["id"] } : { name: t[0], pk_columns: t[1] }
    ),
    fk_edges,
    preserved,
  };
}

const order = (plan: ReturnType<typeof planCopy>) => plan.steps.map((s) => s.table);
const stepFor = (plan: ReturnType<typeof planCopy>, table: string) =>
  plan.steps.find((s) => s.table === table)!;

describe("planCopy — ordering", () => {
  it("puts dependencies before dependents", () => {
    const plan = planCopy(
      graph(
        ["course_tee_holes", "courses", "course_tee_boxes"],
        [
          edge({ from_table: "course_tee_boxes", to_table: "courses" }),
          edge({ from_table: "course_tee_holes", to_table: "course_tee_boxes" }),
        ]
      )
    );

    expect(order(plan)).toEqual(["courses", "course_tee_boxes", "course_tee_holes"]);
    expect(plan.uncovered).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it("is deterministic — independent tables come out alphabetically", () => {
    const plan = planCopy(graph(["zebra", "alpha", "mike"], []));
    expect(order(plan)).toEqual(["alpha", "mike", "zebra"]);
  });

  it("ignores self-references when ordering (they resolve on the re-drive pass)", () => {
    const plan = planCopy(
      graph(
        ["profiles"],
        [
          edge({
            from_table: "profiles",
            to_table: "profiles",
            from_columns: ["created_by"],
            is_self: true,
          }),
        ]
      )
    );

    expect(order(plan)).toEqual(["profiles"]);
    expect(stepFor(plan, "profiles").nullColumns).toEqual([]);
  });

  it("carries the primary key through as the upsert conflict target", () => {
    const plan = planCopy(
      graph([["round_hole_states", ["participant_id", "hole_number"]], ["rounds", ["id"]]], [])
    );

    expect(stepFor(plan, "round_hole_states").onConflict).toBe("participant_id,hole_number");
    expect(stepFor(plan, "rounds").onConflict).toBe("id");
  });

  it("uses a plain insert for a table with no primary key", () => {
    const plan = planCopy(graph([["keyless", []]], []));
    expect(stepFor(plan, "keyless").onConflict).toBeNull();
  });
});

describe("planCopy — cycles", () => {
  it("breaks a two-table cycle on a nullable edge and registers a fixup", () => {
    // rounds ↔ event_tee_times: both directions nullable.
    const plan = planCopy(
      graph(
        ["rounds", "event_tee_times", "events"],
        [
          edge({
            from_table: "rounds",
            to_table: "event_tee_times",
            from_columns: ["event_tee_time_id"],
          }),
          edge({ from_table: "event_tee_times", to_table: "rounds", from_columns: ["round_id"] }),
          edge({ from_table: "event_tee_times", to_table: "events" }),
        ]
      )
    );

    expect(plan.fixups).toHaveLength(1);
    const fixup = plan.fixups[0];
    // Whichever side was broken is deferred, not permanently nulled.
    expect(stepFor(plan, fixup.table).deferredColumns).toEqual(fixup.columns);
    expect(stepFor(plan, fixup.table).nullColumns).toEqual([]);
    // Both tables still get copied, and the un-broken side keeps its reference.
    expect(order(plan)).toHaveLength(3);
    expect(plan.blocked).toEqual([]);
  });

  it("breaks the cycle on the only nullable side when the other is NOT NULL", () => {
    // events.published_rules_version_id is nullable; event_rules_versions.event_id is not.
    const plan = planCopy(
      graph(
        ["events", "event_rules_versions"],
        [
          edge({
            from_table: "events",
            to_table: "event_rules_versions",
            from_columns: ["published_rules_version_id"],
          }),
          edge({
            from_table: "event_rules_versions",
            to_table: "events",
            from_columns: ["event_id"],
            nullable: false,
          }),
        ]
      )
    );

    expect(plan.fixups).toEqual([
      { table: "events", columns: ["published_rules_version_id"] },
    ]);
    expect(order(plan)).toEqual(["events", "event_rules_versions"]);
    expect(stepFor(plan, "events").deferredColumns).toEqual(["published_rules_version_id"]);
    expect(stepFor(plan, "event_rules_versions").nullColumns).toEqual([]);
  });

  it("blocks a cycle that has no nullable edge rather than looping", () => {
    const plan = planCopy(
      graph(
        ["a", "b"],
        [
          edge({ from_table: "a", to_table: "b", nullable: false }),
          edge({ from_table: "b", to_table: "a", nullable: false }),
        ]
      )
    );

    expect(order(plan)).toEqual([]);
    expect(plan.blocked.map((b) => b.table).sort()).toEqual(["a", "b"]);
    expect(plan.uncovered).toEqual([]);
  });

  it("does not sever a pair when only one of two parallel edges is nullable", () => {
    const plan = planCopy(
      graph(
        ["a", "b"],
        [
          edge({ from_table: "a", to_table: "b", from_columns: ["b_one"], nullable: true }),
          edge({ from_table: "a", to_table: "b", from_columns: ["b_two"], nullable: false }),
          edge({ from_table: "b", to_table: "a", nullable: true }),
        ]
      )
    );

    // a→b is unbreakable, so b must be the one nulled — which leaves b with no
    // dependencies, so b is written first and a follows.
    expect(plan.fixups.map((f) => f.table)).toEqual(["b"]);
    expect(order(plan)).toEqual(["b", "a"]);
  });
});

describe("planCopy — unreachable and denied targets", () => {
  it("nulls a nullable reference into another schema", () => {
    const plan = planCopy(
      graph(
        ["profiles"],
        [
          edge({
            from_table: "profiles",
            to_table: "users",
            to_schema: "auth",
            from_columns: ["owner_user_id"],
          }),
        ]
      )
    );

    expect(stepFor(plan, "profiles").nullColumns).toEqual(["owner_user_id"]);
  });

  it("nulls references into denylisted tables instead of dropping the rows", () => {
    // fantasy_odds_snapshots is denied; fantasy_picks.odds_snapshot_id is nullable.
    const plan = planCopy(
      graph(
        ["fantasy_picks", "fantasy_odds_snapshots"],
        [
          edge({
            from_table: "fantasy_picks",
            to_table: "fantasy_odds_snapshots",
            from_columns: ["odds_snapshot_id"],
          }),
        ]
      )
    );

    expect(plan.denied.map((d) => d.table)).toContain("fantasy_odds_snapshots");
    expect(order(plan)).toEqual(["fantasy_picks"]);
    expect(stepFor(plan, "fantasy_picks").nullColumns).toEqual(["odds_snapshot_id"]);
  });

  it("remaps group_charges.created_by to the operator rather than blocking the table", () => {
    // NOT NULL REFERENCES auth.users(id) — the one created_by in the schema that
    // points at auth. It can't be nulled and prod's value can't exist in staging.
    const plan = planCopy(
      graph(
        ["group_charges"],
        [
          edge({
            from_table: "group_charges",
            to_table: "users",
            to_schema: "auth",
            from_columns: ["created_by"],
            nullable: false,
          }),
        ]
      )
    );

    expect(plan.blocked).toEqual([]);
    expect(stepFor(plan, "group_charges").operatorColumns).toEqual(["created_by"]);
    expect(stepFor(plan, "group_charges").nullColumns).toEqual([]);
  });

  it("blocks a NOT NULL reference into an uncopyable table with a named reason", () => {
    const plan = planCopy(
      graph(
        ["widgets"],
        [
          edge({
            from_table: "widgets",
            to_table: "users",
            to_schema: "auth",
            from_columns: ["owner"],
            nullable: false,
          }),
        ]
      )
    );

    expect(order(plan)).toEqual([]);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].table).toBe("widgets");
    expect(plan.blocked[0].reason).toContain("auth.users");
  });

  it("drops dependencies on a blocked table so the rest still copies", () => {
    const plan = planCopy(
      graph(
        ["widgets", "widget_parts"],
        [
          edge({
            from_table: "widgets",
            to_table: "users",
            to_schema: "auth",
            from_columns: ["owner"],
            nullable: false,
          }),
          edge({ from_table: "widget_parts", to_table: "widgets" }),
        ]
      )
    );

    expect(order(plan)).toEqual(["widget_parts"]);
    expect(stepFor(plan, "widget_parts").nullColumns).toEqual(["widgets_id"]);
  });
});

describe("planCopy — coverage", () => {
  it("accounts for every discovered table", () => {
    const plan = planCopy(
      graph(
        ["courses", "push_subscriptions", "ciaga_system_settings", "profiles"],
        [edge({ from_table: "push_subscriptions", to_table: "profiles" })],
        ["ciaga_system_settings"]
      )
    );

    expect(plan.discovered).toBe(4);
    expect(order(plan)).toEqual(["courses", "profiles"]);
    expect(plan.denied.map((d) => d.table)).toEqual(["push_subscriptions"]);
    expect(plan.preserved).toEqual(["ciaga_system_settings"]);
    expect(plan.uncovered).toEqual([]);
  });

  it("never copies a preserved table", () => {
    const plan = planCopy(graph(["ciaga_dump_objects", "courses"], [], ["ciaga_dump_objects"]));
    expect(order(plan)).toEqual(["courses"]);
  });
});

describe("planCopy — permanent vs deferred nulls", () => {
  it("keeps a denied-target null out of the cycle fixup", () => {
    // `a` is both half of a cycle with `b` AND references a denylisted table.
    // The fixup must restore only the cycle column; restoring the denied
    // reference would point at a row that was never copied.
    const plan = planCopy(
      graph(
        ["a", "b", "push_subscriptions"],
        [
          edge({ from_table: "a", to_table: "b", from_columns: ["b_id"] }),
          edge({ from_table: "b", to_table: "a", from_columns: ["a_id"], nullable: false }),
          edge({
            from_table: "a",
            to_table: "push_subscriptions",
            from_columns: ["sub_id"],
          }),
        ]
      )
    );

    const a = stepFor(plan, "a");
    expect(a.deferredColumns).toEqual(["b_id"]);
    expect(a.nullColumns).toEqual(["sub_id"]);
    expect(plan.fixups).toEqual([{ table: "a", columns: ["b_id"] }]);

    const row = { id: "1", b_id: "B", sub_id: "S" };
    expect(applyStepTransform(a, row, "op", "initial")).toEqual({
      id: "1",
      b_id: null,
      sub_id: null,
    });
    expect(applyStepTransform(a, row, "op", "fixup")).toEqual({
      id: "1",
      b_id: "B",
      sub_id: null,
    });
  });
});

describe("applyStepTransform", () => {
  const empty = { nullColumns: [], deferredColumns: [], operatorColumns: [] };

  it("returns the row untouched when there is nothing to change", () => {
    const row = { id: "1", name: "x" };
    expect(applyStepTransform(empty, row, "op")).toBe(row);
  });

  it("nulls and remaps without mutating the source row", () => {
    const row = { id: "1", owner_user_id: "prod-uid", created_by: "prod-uid" };
    const out = applyStepTransform(
      { nullColumns: ["owner_user_id"], deferredColumns: [], operatorColumns: ["created_by"] },
      row,
      "staging-uid"
    );

    expect(out).toEqual({ id: "1", owner_user_id: null, created_by: "staging-uid" });
    expect(row.owner_user_id).toBe("prod-uid");
  });

  it("still applies the operator remap on the fixup pass", () => {
    const out = applyStepTransform(
      { nullColumns: [], deferredColumns: ["round_id"], operatorColumns: ["created_by"] },
      { id: "1", round_id: "R", created_by: "prod-uid" },
      "staging-uid",
      "fixup"
    );

    expect(out).toEqual({ id: "1", round_id: "R", created_by: "staging-uid" });
  });
});
