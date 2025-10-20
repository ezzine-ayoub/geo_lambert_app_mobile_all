// AnalyticLineService - Simple service for account.analytic.line
import { getStoredCredentials } from "./authService";
import { getCurrentApiUrl } from "./config/configService";

export interface AnalyticLineData {
  task_id: number;
  employee_id: number;
  name?: string;
  unit_amount?: number;
  amount?: number;
  date?: string;
  project_id?: number;
}

export const analyticLineService = {
  /**
   * Create analytic line
   */
  async create(datas: AnalyticLineData) {
    try {
      const credentials = await getStoredCredentials();
      if (!credentials) throw new Error('Not authenticated');
      const vals: any = {
        task_id: datas.task_id,
        employee_id: datas.employee_id,
        name: datas.name || 'Timesheet',
        date: datas.date || new Date().toISOString().split('T')[0],
      };

      if (datas.unit_amount !== undefined) vals.unit_amount = datas.unit_amount;
      if (datas.amount !== undefined) vals.amount = datas.amount;
      if (datas.project_id !== undefined) vals.project_id = datas.project_id;

      const payload = {
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'account.analytic.line',
        method: 'create',
        kwargs: {
          vals,
          with_fields: true,
          fields: ['id', 'name', 'task_id', 'employee_id', 'unit_amount', 'amount', 'date', 'project_id']
        }
      };

      const response = await fetch(getCurrentApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      return data.success ? { success: true, result: data.result } : { success: false, message: data.error };

    }
    catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Error' };
    }
  },

};

export default analyticLineService;
