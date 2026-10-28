export const DEFAULT_TEMPLATES = [
    {
        typeKey: 'joining_letter',
        typeLabel: 'Joining Letter',
        kind: 'letter',
        title: 'Letter of Joining',
        body: `Dear {{employeeName}},

We are pleased to confirm your appointment as {{position}} at {{companyName}}, with effect from {{joiningDate}}.

Your remuneration and other terms of employment are as discussed and agreed with you. You are expected to follow the policies and code of conduct of {{companyName}} and to carry out your duties with diligence and integrity.

We welcome you to the team and wish you a successful and rewarding career with us.`,
    },
    {
        typeKey: 'offer_letter',
        typeLabel: 'Offer Letter',
        kind: 'letter',
        title: 'Offer of Employment',
        body: `Dear {{employeeName}},

On behalf of {{companyName}}, we are delighted to offer you the position of {{position}}. Your expected start date is {{joiningDate}}.

Your monthly salary will be {{currency}} {{salary}}. Other terms and conditions will be shared with you in writing before you start.

Please confirm your acceptance of this offer by replying to this email. We look forward to working with you.`,
    },
    {
        typeKey: 'experience_letter',
        typeLabel: 'Experience Letter',
        kind: 'letter',
        title: 'Experience Letter',
        body: `To whom it may concern,

This is to certify that {{employeeName}} worked with {{companyName}} as {{position}} from {{joiningDate}} to {{endDate}}.

During this period, {{employeeName}} performed their duties diligently and conducted themselves professionally. We wish them every success in their future endeavours.`,
    },
    {
        typeKey: 'employment_verification_letter',
        typeLabel: 'Employment Verification Letter',
        kind: 'letter',
        title: 'Employment Verification Letter',
        body: `To whom it may concern,

This is to confirm that {{employeeName}} is currently employed with {{companyName}} as {{position}}, and has been with us since {{joiningDate}}.

This letter is issued at the request of the employee for whatever purpose it may serve.`,
    },
    {
        typeKey: 'salary_certificate',
        typeLabel: 'Salary Certificate',
        kind: 'letter',
        title: 'Salary Certificate',
        body: `To whom it may concern,

This is to certify that {{employeeName}} is employed with {{companyName}} as {{position}} since {{joiningDate}}, and currently receives a monthly salary of {{currency}} {{salary}}.

This certificate is issued at the request of the employee, without any liability on the part of the company.`,
    },
    {
        typeKey: 'promotion_letter',
        typeLabel: 'Promotion Letter',
        kind: 'letter',
        title: 'Letter of Promotion',
        body: `Dear {{employeeName}},

In recognition of your performance and contribution, we are pleased to promote you to the position of {{newPosition}}, effective {{effectiveDate}}.

Congratulations, and thank you for your continued hard work. We are confident you will do well in your new role.`,
    },
    {
        typeKey: 'relieving_letter',
        typeLabel: 'Relieving Letter',
        kind: 'letter',
        title: 'Relieving Letter',
        body: `Dear {{employeeName}},

This is to confirm that you have been relieved from your duties as {{position}} at {{companyName}} with effect from {{endDate}}, following the acceptance of your resignation.

We thank you for your service and wish you all the best in your future career.`,
    },
    {
        typeKey: 'warning_letter',
        typeLabel: 'Warning Letter',
        kind: 'letter',
        title: 'Warning Letter',
        body: `Dear {{employeeName}},

It has come to our attention that {{reason}}. This is not in line with the standards expected at {{companyName}}.

Please treat this letter as a formal warning. Further occurrences may lead to disciplinary action. If you wish to discuss this matter, please contact management.`,
    },
    {
        typeKey: 'appreciation_certificate',
        typeLabel: 'Appreciation Certificate',
        kind: 'certificate',
        title: 'Certificate of Appreciation',
        body: `in sincere appreciation of outstanding dedication, hard work and valuable contribution to {{companyName}}.`,
    },
    {
        typeKey: 'achievement_certificate',
        typeLabel: 'Achievement Certificate',
        kind: 'certificate',
        title: 'Certificate of Achievement',
        body: `for outstanding achievement: {{achievement}}.

Awarded on {{issueDate}}.`,
    },
    {
        typeKey: 'course_completion_certificate',
        typeLabel: 'Course Completion Certificate',
        kind: 'certificate',
        title: 'Certificate of Completion',
        body: `for successfully completing the course "{{courseName}}" and demonstrating commitment and dedication throughout the programme.`,
    },
];
export const getDefaultTemplate = (typeKey) => DEFAULT_TEMPLATES.find(t => t.typeKey === typeKey);
