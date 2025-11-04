export const CONSTANTS = {
  // Response templates
  THINKING_MESSAGES: [
    "Looking that up for you...",
    "Let me check on that...",
    "One moment...",
    "Checking our resources...",
    "Getting that information..."
  ],

  // Categories for knowledge base
  KNOWLEDGE_CATEGORIES: {
    COMMISSIONS: 'commissions',
    HEALTHSHERPA: 'healthsherpa',
    CARRIERS: 'carriers',
    COMPLIANCE: 'compliance',
    ENROLLMENT: 'enrollment',
    TROUBLESHOOTING: 'troubleshooting',
    POLICIES: 'policies',
    TRAINING: 'training'
  },

  // Escalation triggers
  ESCALATION_KEYWORDS: [
    'legal action',
    'lawsuit',
    'compliance violation',
    'license suspension',
    'cms audit',
    'termination',
    'ethics violation',
    'fraud',
    'investigation'
  ],

  // Priority keywords for faster response
  PRIORITY_KEYWORDS: [
    'urgent',
    'emergency',
    'asap',
    'immediately',
    'critical',
    'help now'
  ],

  // Common acronyms and their meanings
  ACRONYMS: {
    'ACA': 'Affordable Care Act',
    'SEP': 'Special Enrollment Period',
    'OEP': 'Open Enrollment Period',
    'APTC': 'Advanced Premium Tax Credit',
    'CSR': 'Cost Sharing Reduction',
    'FFM': 'Federally Facilitated Marketplace',
    'SBM': 'State Based Marketplace',
    'QHP': 'Qualified Health Plan',
    'SLCSP': 'Second Lowest Cost Silver Plan',
    'FPL': 'Federal Poverty Level',
    'MEC': 'Minimum Essential Coverage'
  },

  // Carrier specific information
  CARRIERS: {
    'BCBS': {
      name: 'Blue Cross Blue Shield',
      commission: '10-15%',
      payment: 'Monthly'
    },
    'UHC': {
      name: 'United Healthcare',
      commission: '10-12%',
      payment: 'Monthly'
    },
    'AETNA': {
      name: 'Aetna',
      commission: '8-12%',
      payment: 'Monthly'
    },
    'CIGNA': {
      name: 'Cigna',
      commission: '10-14%',
      payment: 'Monthly'
    }
  }
};
