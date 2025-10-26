export type User = {
  name: string;
  email: string;
  avatarUrl: string;
  role: 'Admin' | 'Technician' | 'Client' | 'Contractor';
};

export type PipelineStage = 'leads' | 'cold-leads' | 'hot-leads' | 'meeting-booked' | 'deal-closed' | 'onboarding';

export type Lead = {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  stage: PipelineStage;
  value: number;
  probability: number;
  serviceType: string;
  assignedTo: string;
  avatarUrl: string;
};

export type Job = {
    id: string;
    title: string;
    client: string;
    status: 'Pending' | 'In Progress' | 'Completed';
    assigned: string;
}
