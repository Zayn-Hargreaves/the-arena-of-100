import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from "class-validator";
import fastDeepEqual from "fast-deep-equal";

@ValidatorConstraint({ async: false })
export class IsInArrayConstraint implements ValidatorConstraintInterface {
  private relatedNotArray = false;
  private notFound = false;

  validate(value: any, args: ValidationArguments) {
    // Reset flags for each validation
    this.relatedNotArray = false;
    this.notFound = false;
    
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as any)[relatedPropertyName];

    if (!Array.isArray(relatedValue)) {
      this.relatedNotArray = true;
      return false;
    }

    // Use deep equality check instead of includes for object comparison
    this.notFound = !relatedValue.some(item => fastDeepEqual(item, value));
    return !this.notFound;
  }

  defaultMessage(args: ValidationArguments) {
    const [relatedPropertyName] = args.constraints;
    
    if (this.relatedNotArray) {
      return `related field '${relatedPropertyName}' is not an array`;
    }
    
    if (this.notFound) {
      return `value not found in related array '${relatedPropertyName}'`;
    }
    
    return `${args.property} must be one of the provided ${relatedPropertyName}`;
  }
}

/**
 * Validates that a property's value is included in an array from another property.
 * @param property - The name of the property containing the array to validate against
 * @param validationOptions - Optional validation options
 * @example
 * class MyClass {
 *   allowedValues = ['a', 'b', 'c'];
 *   
 *   @IsInArray('allowedValues')
 *   selectedValue: string;
 * }
 */
export function IsInArray(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsInArrayConstraint,
    });
  };
}
