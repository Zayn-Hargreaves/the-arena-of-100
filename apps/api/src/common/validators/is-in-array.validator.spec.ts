import { validate } from "class-validator";
import { IsInArray } from "./is-in-array.validator";

class TestDto {
  options!: any[];

  @IsInArray("options")
  selectedValue!: any;
}

describe("IsInArrayValidator", () => {
  it("should validate when value is in array", async () => {
    const dto = new TestDto();
    dto.options = ["a", "b", "c"];
    dto.selectedValue = "b";

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should not validate when value is not in array", async () => {
    const dto = new TestDto();
    dto.options = ["a", "b", "c"];
    dto.selectedValue = "d";

    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].property).toBe("selectedValue");
    expect(errors[0].constraints).toBeDefined();
    expect(errors[0].constraints?.IsInArrayConstraint).toContain("value not found in related array");
  });

  it("should not validate when related field is not an array", async () => {
    const dto = new TestDto();
    dto.options = "not-an-array";
    dto.selectedValue = "a";

    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].property).toBe("selectedValue");
    expect(errors[0].constraints).toBeDefined();
    expect(errors[0].constraints?.IsInArrayConstraint).toContain("related field 'options' is not an array");
  });

  it("should work with object values using deep equality", async () => {
    const dto = new TestDto();
    dto.options = [
      { id: 1, name: "option1" },
      { id: 2, name: "option2" }
    ];
    dto.selectedValue = { id: 2, name: "option2" }; // Same values, different reference

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should not validate object values when not found using deep equality", async () => {
    const dto = new TestDto();
    dto.options = [
      { id: 1, name: "option1" },
      { id: 2, name: "option2" }
    ];
    dto.selectedValue = { id: 3, name: "option3" };

    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].property).toBe("selectedValue");
    expect(errors[0].constraints).toBeDefined();
    expect(errors[0].constraints?.IsInArrayConstraint).toContain("value not found in related array");
  });
});