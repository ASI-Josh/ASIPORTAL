import type { Lead, PipelineStage } from './types';
import { Timestamp } from 'firebase/firestore';

// Mock user is now handled by AuthContext

export const PIPELINE_STAGES: { id: PipelineStage; title: string }[] = [
  { id: 'leads', title: 'New Leads' },
  { id: 'cold-leads', title: 'Cold Leads' },
  { id: 'hot-leads', title: 'Hot Leads' },
  { id: 'meeting-booked', title: 'Meeting Booked' },
  { id: 'deal-closed', title: 'Deal Closed' },
  { id: 'onboarding', title: 'Onboarding' },
];

export const mockLeads: Lead[] = [
  {
    id: 'lead-1',
    companyName: 'Innovate Corp',
    contactPerson: 'Alice Johnson',
    email: 'alice@innovate.com',
    stage: 'hot-leads',
    value: 75000,
    probability: 0.8,
    serviceType: 'Film Installation',
    assignedTo: 'Joshua',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: 'lead-2',
    companyName: 'Tech Solutions Ltd.',
    contactPerson: 'Bob Williams',
    email: 'bob@techsolutions.com',
    stage: 'leads',
    value: 50000,
    probability: 0.2,
    serviceType: 'Repair',
    assignedTo: 'Jaydan',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: 'lead-3',
    companyName: 'Synergy Group',
    contactPerson: 'Charlie Brown',
    email: 'charlie@synergy.com',
    stage: 'meeting-booked',
    value: 120000,
    probability: 0.6,
    serviceType: 'Inspection',
    assignedTo: 'Bobby',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: 'lead-4',
    companyName: 'Quantum Dynamics',
    contactPerson: 'Diana Prince',
    email: 'diana@quantum.com',
    stage: 'hot-leads',
    value: 95000,
    probability: 0.75,
    serviceType: 'Film Installation',
    assignedTo: 'Joshua',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
   {
    id: 'lead-5',
    companyName: 'Global Logistics',
    contactPerson: 'Ethan Hunt',
    email: 'ethan@globallogistics.com',
    stage: 'cold-leads',
    value: 30000,
    probability: 0.1,
    serviceType: 'PDI Service',
    assignedTo: 'Jaydan',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: 'lead-6',
    companyName: 'Apex Constructors',
    contactPerson: 'Fiona Glenanne',
    email: 'fiona@apex.com',
    stage: 'deal-closed',
    value: 250000,
    probability: 1.0,
    serviceType: 'Full Fleet Service',
    assignedTo: 'Bobby',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }
];


// Mock jobs structure (for display only - will be replaced with real data)
export const mockJobsDisplay = [
    { id: 'JOB-001', title: 'Windshield Repair', client: 'John Doe', status: 'completed' as const, assigned: 'Tech 1' },
    { id: 'JOB-002', title: 'Film Installation', client: 'Jane Smith', status: 'in_progress' as const, assigned: 'Tech 2' },
    { id: 'JOB-003', title: 'Damage Inspection', client: 'Peter Jones', status: 'pending' as const, assigned: 'Tech 1' },
    { id: 'JOB-004', title: 'PDI Service', client: 'Mary Johnson', status: 'completed' as const, assigned: 'Tech 3' },
    { id: 'JOB-005', title: 'Scratch Removal', client: 'David Williams', status: 'in_progress' as const, assigned: 'Tech 2' },
]

export const revenueData = [
  { month: "Jan", revenue: 4000 },
  { month: "Feb", revenue: 3000 },
  { month: "Mar", revenue: 5000 },
  { month: "Apr", revenue: 4500 },
  { month: "May", revenue: 6000 },
  { month: "Jun", revenue: 5500 },
  { month: "Jul", revenue: 7000 },
];
