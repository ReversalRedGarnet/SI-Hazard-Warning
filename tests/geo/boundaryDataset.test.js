import { describe, it, expect } from "vitest";
import { loadBoundaryDataset } from "../../src/geo/boundaryDataset.js";
import { BOUNDARY_STATUS } from "../../src/geo/AdministrativeUnit.js";

describe("loadBoundaryDataset", () => {
  it("loads the country root plus 10 ADM1 units (9 provinces + Honiara)", () => {
    const { units } = loadBoundaryDataset();
    expect(units).toHaveLength(11);

    const country = units.find((u) => u.unit_type === "country");
    expect(country.id).toBe("SB");
    expect(country.geometry).toBeNull();
  });

  it("models Honiara as a city, a sibling of Guadalcanal under the country — not nested inside it", () => {
    const { units } = loadBoundaryDataset();
    const honiara = units.find((u) => u.name === "Honiara");
    const guadalcanal = units.find((u) => u.name === "Guadalcanal");

    expect(honiara.unit_type).toBe("city");
    expect(guadalcanal.unit_type).toBe("province");
    expect(honiara.parent_id).toBe("SB");
    expect(honiara.parent_id).toBe(guadalcanal.parent_id);
  });

  it("marks every unit and the dataset itself DEVELOPMENT_ONLY", () => {
    const { units, provenance } = loadBoundaryDataset();
    expect(provenance.boundary_status).toBe(BOUNDARY_STATUS.DEVELOPMENT_ONLY);
    for (const unit of units) {
      expect(unit.boundary_status).toBe(BOUNDARY_STATUS.DEVELOPMENT_ONLY);
    }
  });

  it("carries full provenance including a geometry_hash computed from the actual bundled file", () => {
    const { provenance } = loadBoundaryDataset();
    expect(provenance.dataset_id).toBe("hdx-cod-ab-slb-adm1");
    expect(provenance.source_agency).toContain("SINSO");
    expect(provenance.geometry_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.verification_status).toBe("UNVERIFIED_PROTOTYPE");
    expect(provenance.effective_to).toBeNull();
  });

  it("caches the result across calls", () => {
    expect(loadBoundaryDataset()).toBe(loadBoundaryDataset());
  });
});
