// A realistic discharge summary for the care-file demo (and for judges to edit live).
export const EXAMPLE_DISCHARGE = `MOUNT AUBURN HOSPITAL — DISCHARGE SUMMARY
Patient: Eleanor Vance   DOB: 03/14/1945
Discharged: after observation for a mechanical fall, no fracture.

DIAGNOSES: Type 2 diabetes. Hypertension. Mild osteoarthritis, both knees.
ALLERGIES: PENICILLIN (rash).

MEDICATIONS ON DISCHARGE
1. Metformin 500 mg — twice daily with meals
2. Lisinopril 10 mg — every morning
3. Atorvastatin 20 mg — at bedtime

FOLLOW-UP
Cardiology: Dr. Sarah Osei, Thursday Oct 2, 2:00 PM, Mount Auburn Cardiology,
330 Mount Auburn St. Bring current medication list. Office: (617) 555-0199.

Patient advised to use handrail on stairs and continue daily walks as tolerated.`;

// The canned parse of the document above — used when no AI key is configured so
// the demo works offline. Kept honest: it matches the example verbatim.
export const EXAMPLE_EXTRACT = {
  medications: [
    { name: 'Metformin', dose: '500 mg', timing: 'twice daily with meals' },
    { name: 'Lisinopril', dose: '10 mg', timing: 'every morning' },
    { name: 'Atorvastatin', dose: '20 mg', timing: 'at bedtime' },
  ],
  appointments: [
    {
      title: 'Cardiology — Dr. Osei',
      when: 'Thursday Oct 2, 2:00 PM',
      where: 'Mount Auburn Cardiology, 330 Mount Auburn St',
      note: 'Bring current medication list',
    },
  ],
  emergency: {
    allergies: ['Penicillin (rash)'],
    conditions: ['Type 2 diabetes', 'Hypertension', 'Osteoarthritis (knees)'],
    doctor: { name: 'Dr. Sarah Osei', phone: '(617) 555-0199' },
  },
  summary: '3 medications, 1 appointment, 1 allergy, her cardiologist',
};
