import { ClusterService } from "./cluster.service";

// B2b: ownership tracking moved to MatchOwnershipService; ClusterService now
// only carries nodeId + the local socket-count metric (no Redis dependency).
describe("ClusterService", () => {
  const ORIGINAL_INSTANCE_ID = process.env.INSTANCE_ID;
  afterEach(() => {
    vi.restoreAllMocks();
    // Restore INSTANCE_ID even if a test that mutated it failed mid-way.
    if (ORIGINAL_INSTANCE_ID === undefined) delete process.env.INSTANCE_ID;
    else process.env.INSTANCE_ID = ORIGINAL_INSTANCE_ID;
  });

  it("derives nodeId from INSTANCE_ID", () => {
    const prev = process.env.INSTANCE_ID;
    process.env.INSTANCE_ID = "api-7";
    const svc = new ClusterService();
    expect(svc.nodeId).toBe("api-7");
    process.env.INSTANCE_ID = prev;
  });

  it("returns 0 sockets before the server is wired", () => {
    const svc = new ClusterService();
    expect(svc.getLocalSocketCount()).toBe(0);
  });

  it("counts local sockets from the /game namespace map", () => {
    const svc = new ClusterService();
    svc.setServer({
      sockets: new Map([
        ["a", {}],
        ["b", {}],
      ]),
    } as never);
    expect(svc.getLocalSocketCount()).toBe(2);
  });
});
