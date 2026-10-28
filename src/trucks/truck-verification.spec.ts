import {
  truckVerification,
  type TruckDocumentSummary,
} from './truck-verification';

const TODAY = '2026-10-28';

function doc(
  type: string,
  status: string,
  overrides: Partial<TruckDocumentSummary> = {},
): TruckDocumentSummary {
  return {
    type,
    status,
    expiryDate: '2027-06-30',
    submittedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

const allApproved = [
  doc('VEHICLE_REGISTRATION', 'APPROVED'),
  doc('VEHICLE_INSPECTION', 'APPROVED'),
  doc('INSURANCE_POLICY', 'APPROVED'),
];

describe('truckVerification', () => {
  it('is verified once all three required documents are approved', () => {
    expect(truckVerification(allApproved, TODAY)).toBe('APPROVED');
  });

  it('is not verified while a required document is missing', () => {
    expect(truckVerification(allApproved.slice(0, 2), TODAY)).toBe(
      'NOT_SUBMITTED',
    );
  });

  it('waits for review while any document is pending', () => {
    expect(
      truckVerification(
        [...allApproved.slice(0, 2), doc('INSURANCE_POLICY', 'PENDING')],
        TODAY,
      ),
    ).toBe('PENDING');
  });

  it('is rejected when the administrator rejects a document', () => {
    expect(
      truckVerification(
        [...allApproved.slice(0, 2), doc('INSURANCE_POLICY', 'REJECTED')],
        TODAY,
      ),
    ).toBe('REJECTED');
  });

  it('lapses when an approved document has expired', () => {
    expect(
      truckVerification(
        [
          ...allApproved.slice(0, 2),
          doc('INSURANCE_POLICY', 'APPROVED', { expiryDate: '2026-10-27' }),
        ],
        TODAY,
      ),
    ).toBe('EXPIRED');
  });

  it('uses the newest submission of each document type', () => {
    expect(
      truckVerification(
        [
          ...allApproved,
          doc('INSURANCE_POLICY', 'PENDING', {
            submittedAt: '2026-10-20T08:00:00.000Z',
          }),
        ],
        TODAY,
      ),
    ).toBe('PENDING');
  });
});
