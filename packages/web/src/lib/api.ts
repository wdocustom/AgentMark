const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('am_token', token);
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('am_token');
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('am_token');
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;
    const token = this.getToken();

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new ApiError(data.error?.message || 'Request failed', data.error?.code || 'UNKNOWN', res.status);
    }

    return data;
  }

  // Auth
  async login(email: string, password: string) {
    const res = await this.request<{ success: boolean; data: { token: string } }>('/api/auth/login', {
      method: 'POST', body: { email, password },
    });
    this.setToken(res.data.token);
    return res;
  }

  async register(email: string, password: string, name: string, organizationName: string) {
    const res = await this.request<{ success: boolean; data: { token: string; userId: string } }>('/api/auth/register', {
      method: 'POST', body: { email, password, name, organizationName },
    });
    this.setToken(res.data.token);
    return res;
  }

  async getMe() {
    return this.request<{ success: boolean; data: any }>('/api/auth/me');
  }

  // Content
  async getContent(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<{ success: boolean; data: any[]; pagination: any }>(`/api/content${qs}`);
  }

  async createContent(data: any) {
    return this.request<{ success: boolean; data: any }>('/api/content', { method: 'POST', body: data });
  }

  async getContentById(id: string) {
    return this.request<{ success: boolean; data: any }>(`/api/content/${id}`);
  }

  async updateContent(id: string, data: any) {
    return this.request<{ success: boolean; data: any }>(`/api/content/${id}`, { method: 'PUT', body: data });
  }

  // Campaigns
  async getCampaigns(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<{ success: boolean; data: any[]; pagination: any }>(`/api/campaigns${qs}`);
  }

  async createCampaign(data: any) {
    return this.request<{ success: boolean; data: any }>('/api/campaigns', { method: 'POST', body: data });
  }

  async getCampaignById(id: string) {
    return this.request<{ success: boolean; data: any }>(`/api/campaigns/${id}`);
  }

  async updateCampaignStatus(id: string, status: string) {
    return this.request<{ success: boolean; data: any }>(`/api/campaigns/${id}/status`, { method: 'PUT', body: { status } });
  }

  // Analytics
  async getAnalyticsOverview(period?: string) {
    const qs = period ? `?period=${period}` : '';
    return this.request<{ success: boolean; data: any }>(`/api/analytics/overview${qs}`);
  }

  async queryAnalytics(queryData: any) {
    return this.request<{ success: boolean; data: any[] }>('/api/analytics/query', { method: 'POST', body: queryData });
  }

  async getRealtime() {
    return this.request<{ success: boolean; data: any }>('/api/analytics/realtime');
  }

  // Contacts
  async getContacts(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<{ success: boolean; data: any[]; pagination: any }>(`/api/contacts${qs}`);
  }

  async createContact(data: any) {
    return this.request<{ success: boolean; data: any }>('/api/contacts', { method: 'POST', body: data });
  }

  async importContacts(contacts: any[]) {
    return this.request<{ success: boolean; data: any }>('/api/contacts/bulk', { method: 'POST', body: { contacts } });
  }

  // Agents
  async getAgents() {
    return this.request<{ success: boolean; data: any[] }>('/api/agents');
  }

  async getAgentById(id: string) {
    return this.request<{ success: boolean; data: any }>(`/api/agents/${id}`);
  }

  async submitAgentTask(agentType: string, taskType: string, input: any, priority?: number) {
    return this.request<{ success: boolean; data: any }>('/api/agents/task', {
      method: 'POST',
      body: { agentType, taskType, input, priority },
    });
  }

  async getAgentTasks(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<{ success: boolean; data: any[] }>(`/api/agents/tasks/list${qs}`);
  }

  async getTaskResult(taskId: string) {
    return this.request<{ success: boolean; data: any }>(`/api/agents/task/${taskId}`);
  }
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const api = new ApiClient();
