export declare class CreateBookingDto {
    truckId: string;
    cargoType: string;
    cargoDescription?: string;
    cargoWeight: number;
    pickupLocation: string;
    destination: string;
    pickupDate: string;
    expectedDeliveryDate: string;
    additionalInstructions?: string;
}
