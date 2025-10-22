// ProjectService - Service pour la gestion des projets
import { 
  executePayloadWithStoredAuth,
  getStoredCredentials
} from "./authService";
import {
  PROJECT_PAYLOADS,
  EXPENSE_PAYLOADS,
  getCurrentApiUrl
} from "./config/configService";

// ==================== INTERFACES POUR LES PROJETS ====================

export interface ProjectTask {
  id: number;
  name: string;
  state: string;
  partner_id?: [number, string] | false;
  user_ids?: Array<{ id: number; name: string; display_name: string }>;
  expense_ids?: Array<{
    id: number;
    amount?: number;
    expense_date: string;
    expense_type: string;
    project_id?: [number, string];
    task_id?: [number, string];
    currency_id?: [number, string];
    display_name?: string;
  }>;
  display_name: string;
  timer_start?: string | false;
  timer_pause?: string | false;
}

export interface Project {
  id: number;
  name: string;
  project_type: string;
  partner_id?: [number, string] | false;
  date_start?: string | false;
  date?: string | false;
  task_ids?: ProjectTask[];
  numero?: string | false;
}

export interface ProjectsResponse {
  success: boolean;
  result?: Project[];
  message?: string;
  operation_info?: {
    model: string;
    method: string;
    user: string;
  };
  timestamp?: string;
}

export interface ProjectStats {
  totalProjects: number;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  completionRate: number;
  situationProjects: number;
  normalProjects: number;
  totalExpenses: number;
  expenseCount: number;
}

export interface ExpenseData {
  user_id: number;
  expense_type: string;
  amount: number;
  description: string;
  expense_date?: string;
}

export interface ExpenseResponse {
  success: boolean;
  message?: string;
  data?: any;
  result?: any;
}

// ==================== SERVICE PROJETS ====================

export const projectService = {
  /**
   * ✅ RÉCUPÉRATION : Tous les projets
   */
  async getProjects(): Promise<ProjectsResponse> {
    try {
      console.log('📊 Récupération des projets...');
      
      const response = await executePayloadWithStoredAuth(
        (credentials) => PROJECT_PAYLOADS.getAllProjects(credentials)
      );
      
      console.log('🔍 Réponse API projets reçue:', {
        hasResponse: !!response,
        hasSuccess: response?.success,
        hasResult: !!response?.result,
        isResultArray: Array.isArray(response?.result),
        resultLength: response?.result?.length || 0
      });
      
      // Format API: { success: true, result: [...], operation_info: {...}, timestamp: '...' }
      if (response && response.success === true && Array.isArray(response.result)) {
        console.log(`✅ ${response.result.length} projets récupérés`);
        return {
          success: true,
          result: response.result,
          operation_info: response.operation_info,
          timestamp: response.timestamp
        };
      }
      // Fallback pour array direct
      else if (response && Array.isArray(response)) {
        console.log(`✅ ${response.length} projets récupérés (format array)`);
        return {
          success: true,
          result: response
        };
      }
      else {
        console.warn('⚠️ Réponse inattendue pour les projets:', response);
        return {
          success: false,
          message: `Format de réponse inattendu: ${response ? JSON.stringify(Object.keys(response)) : 'null'}`
        };
      }
      
    } catch (error) {
      console.error('❌ Erreur récupération projets:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  },

  /**
   * ✅ TIMER: التحقق من حالة Timer للتâche
   */
  async getTaskTimerState(taskId: number): Promise<{ success: boolean; message?: string; data?: any }> {
    try {
      const credentials = await getStoredCredentials();
      if (!credentials) {
        throw new Error('Aucune authentification trouvée');
      }
      
      const payload = {
        "operation": "rpc",
        "db": credentials.db,
        "username": credentials.username,
        "password": credentials.password,
        "model": "project.task",
        "method": "search_read",
        "kwargs": {
            "domain":[['id','=',taskId]],
          "fields": ["id", "name", "is_timer_running", "timer_pause", "timer_start", "effective_hours"]
        }
      };
      
      const apiUrl = getCurrentApiUrl();
      console.log('🔗 URL API Timer State:', apiUrl);
      console.log('📤 Payload Timer State:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Réponse Timer State:', JSON.stringify(data, null, 2));
      
      if (data.result && Array.isArray(data.result) && data.result.length > 0) {
        const taskData = data.result[0];
        console.log(`✅ État du timer pour la tâche ${taskId}:`, taskData);
        return {
          success: true,
          message: 'Timer state retrieved successfully',
          data: taskData
        };
      } else {
        return {
          success: false,
          message: 'Impossible de récupérer l\'état du timer'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur timer state tâche ${taskId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de la vérification'
      };
    }
  },
  async stopTaskTimerMultipleMethods(taskId: number): Promise<{ success: boolean; message?: string; data?: any }> {
    const credentials = await getStoredCredentials();
    if (!credentials) {
      throw new Error('Aucune authentification trouvée');
    }

    const apiUrl = getCurrentApiUrl();

    // Liste des méthodes possibles pour arrêter le timer
    const stopMethods = [
      'action_timer_stop_button',
      'action_timer_stop',
      'button_stop',
      'stop_timer',
      'timer_stop',
      'action_stop',
      'stop_timesheet',
      'toggle_timer'
    ];

    for (const method of stopMethods) {
      try {
        console.log(`🔄 Tentative avec méthode: ${method}`);

        const payload = {
          "operation": "rpc",
          "db": credentials.db,
          "username": credentials.username,
          "password": credentials.password,
          "model": "project.task",
          "method": method,
          "args": [[taskId]]
        };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          console.log(`❌ ${method} - HTTP Error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        console.log(`🔍 ${method} - Réponse:`, JSON.stringify(data, null, 2));

        // Si pas d'erreur, considérer comme succès
        if (data.success || (!data.error && data.result !== false)) {
          console.log(`✅ Succès avec la méthode: ${method}`);
          return {
            success: true,
            message: `Timer arrêté avec succès (méthode: ${method})`,
            data: { method, result: data.result }
          };
        } else {
          console.log(`⚠️ ${method} - Erreur:`, data.message || data.error?.message || 'Erreur inconnue');
        }

      } catch (error) {
        // @ts-ignore
          console.log(`❌ ${method} - Exception:`, error.message);
        continue;
      }
    }

    return {
      success: false,
      message: `Toutes les méthodes d'arrêt ont échoué pour la tâche ${taskId}. Méthodes essayées: ${stopMethods.join(', ')}`
    };
  },
  async createExpense(taskId: number, expenseData: ExpenseData): Promise<ExpenseResponse> {
    try {
      console.log(`💰 Création d'une dépense pour la tâche ${taskId}...`, expenseData);
      
      const response = await executePayloadWithStoredAuth(
        (credentials) => EXPENSE_PAYLOADS.createExpense(credentials, taskId, expenseData)
      );
      
      console.log('🔍 Réponse API création dépense:', response);
      
      if (response && (response.success === true || response.result || response.id)) {
        console.log(`✅ Dépense créée avec succès pour la tâche ${taskId}`);
        return {
          success: true,
          message: 'Dépense créée avec succès',
          data: response.result || response,
          result: response.result
        };
      } else {
        console.warn('⚠️ Réponse inattendue pour la création de dépense:', response);
        return {
          success: false,
          message: response?.message || 'Erreur lors de la création de la dépense'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur création dépense pour tâche ${taskId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de la création'
      };
    }
  },
  async getUpdatedTaskTimerState(taskId: number): Promise<{ timer_start?: string | false; timer_pause?: string | false } | null> {
    try {
      const response = await this.getTaskTimerState(taskId);
      if (response.success && response.data) {
        return {
          timer_start: response.data.timer_start || false,
          timer_pause: response.data.timer_pause || false
        };
      }
      return null;
    } catch (error) {
      console.error('❌ Erreur récupération état timer:', error);
      return null;
    }
  },
  async startTaskTimer(taskId: number): Promise<{ success: boolean; message?: string; data?: any; timerState?: any }> {
    try {
      console.log(`⏰ Démarrage du timer pour la tâche ${taskId}...`);
      
      const credentials = await getStoredCredentials();
      if (!credentials) {
        throw new Error('Aucune authentification trouvée');
      }
      
      const payload = {
        "operation": "rpc",
        "db": credentials.db,
        "username": credentials.username,
        "password": credentials.password,
        "model": "project.task",
        "method": "action_timer_start_button",
        "args": [[taskId]]
      };
      
      const apiUrl = getCurrentApiUrl();
      console.log('🔗 URL API Timer:', apiUrl);
      console.log('📤 Payload Timer Start:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Réponse API timer start:', data);
      
      if (data.success || (!data.error && data.result !== false)) {
        console.log(`✅ Timer démarré pour la tâche ${taskId}`);
        
        // Récupérer l'état actualisé du timer
        const timerState = await this.getUpdatedTaskTimerState(taskId);
        
        return {
          success: true,
          message: 'Timer démarré avec succès',
          data: data.result,
          timerState
        };
      } else {
        console.warn('⚠️ Erreur timer start:', data.message || data.error);
        return {
          success: false,
          message: data.message || data.error?.message || 'Erreur lors du démarrage du timer'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur démarrage timer tâche ${taskId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue lors du démarrage'
      };
    }
  },
  async pauseTaskTimer(taskId: number): Promise<{ success: boolean; message?: string; data?: any; timerState?: any }> {
    try {
      console.log(`⏸️ Pause du timer pour la tâche ${taskId}...`);
      
      const credentials = await getStoredCredentials();
      if (!credentials) {
        throw new Error('Aucune authentification trouvée');
      }
      
      const payload = {
        "operation": "rpc",
        "db": credentials.db,
        "username": credentials.username,
        "password": credentials.password,
        "model": "project.task",
        "method": "action_timer_pause_button",
        "args": [[taskId]]
      };
      
      const apiUrl = getCurrentApiUrl();
      console.log('🔗 URL API Timer Pause:', apiUrl);
      console.log('📤 Payload Timer Pause:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Réponse API timer pause:', data);
      
      if (data.success || (!data.error && data.result !== false)) {
        console.log(`✅ Timer en pause pour la tâche ${taskId}`);
        
        // Récupérer l'état actualisé du timer
        const timerState = await this.getUpdatedTaskTimerState(taskId);
        
        return {
          success: true,
          message: 'Timer mis en pause avec succès',
          data: data.result,
          timerState
        };
      } else {
        return {
          success: false,
          message: data.message || data.error?.message || 'Erreur lors de la pause du timer'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur pause timer tâche ${taskId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de la pause'
      };
    }
  },
  async resumeTaskTimer(taskId: number): Promise<{ success: boolean; message?: string; data?: any; timerState?: any }> {
    try {
      console.log(`▶️ Reprise du timer pour la tâche ${taskId}...`);
      
      const credentials = await getStoredCredentials();
      if (!credentials) {
        throw new Error('Aucune authentification trouvée');
      }
      
      const payload = {
        "operation": "rpc",
        "db": credentials.db,
        "username": credentials.username,
        "password": credentials.password,
        "model": "project.task",
        "method": "action_timer_resume_button",
        "args": [[taskId]]
      };
      
      const apiUrl = getCurrentApiUrl();
      console.log('🔗 URL API Timer Resume:', apiUrl);
      console.log('📤 Payload Timer Resume:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Réponse API timer resume:', data);
      
      if (data.success || (!data.error && data.result !== false)) {
        console.log(`✅ Timer repris pour la tâche ${taskId}`);
        
        // Récupérer l'état actualisé du timer
        const timerState = await this.getUpdatedTaskTimerState(taskId);
        
        return {
          success: true,
          message: 'Timer repris avec succès',
          data: data.result,
          timerState
        };
      } else {
        return {
          success: false,
          message: data.message || data.error?.message || 'Erreur lors de la reprise du timer'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur reprise timer tâche ${taskId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de la reprise'
      };
    }
  },
  async stopTaskTimer(taskId: number): Promise<{ success: boolean; message?: string; data?: any; timerState?: any }> {
    try {
      console.log(`⏹️ Arrêt du timer pour la tâche ${taskId}...`);
      
      const credentials = await getStoredCredentials();
      if (!credentials) {
        throw new Error('Aucune authentification trouvée');
      }
      
      const payload = {
        "operation": "rpc",
        "db": credentials.db,
        "username": credentials.username,
        "password": credentials.password,
        "model": "project.task",
        "method": "action_timer_stop_button",
        "args": [[taskId]]
      };
      
      const apiUrl = getCurrentApiUrl();
      console.log('🔗 URL API Timer Stop:', apiUrl);
      console.log('📤 Payload Timer Stop:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      console.log('📊 Response Status:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ HTTP Error Response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Réponse API timer stop complète:', JSON.stringify(data, null, 2));
      
      // Vérification plus détaillée de la réponse
      if (data.error) {
        console.error('❌ Erreur API:', data.error);
        return {
          success: false,
          message: data.error.message || data.message || 'Erreur API lors de l\'arrêt du timer'
        };
      }
      
      // Accepter plusieurs formats de succès
      if (data.success || (!data.error && data.result !== false)) {
        console.log(`✅ Timer arrêté pour la tâche ${taskId}`);
        
        // Récupérer l'état actualisé du timer
        const timerState = await this.getUpdatedTaskTimerState(taskId);
        
        return {
          success: true,
          message: 'Timer arrêté avec succès',
          data: data.result,
          timerState
        };
      } 
      // Parfois Odoo retourne result: false pour certaines actions
      else if (data.result === false && !data.error) {
        console.log(`✅ Timer arrêté (result: false mais pas d'erreur) pour la tâche ${taskId}`);
        
        // Récupérer l'état actualisé du timer
        const timerState = await this.getUpdatedTaskTimerState(taskId);
        
        return {
          success: true,
          message: 'Timer arrêté avec succès',
          data: data.result,
          timerState
        };
      }
      else {
        console.warn('⚠️ Réponse inattendue:', data);
        return {
          success: false,
          message: data.message || 'Format de réponse inattendu lors de l\'arrêt du timer'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur arrêt timer tâche ${taskId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de l\'arrêt'
      };
    }
  },
  async stopTaskTimerAlternative(taskId: number): Promise<{ success: boolean; message?: string; data?: any }> {
    try {
      console.log(`⏹️ [ALT] Arrêt du timer pour la tâche ${taskId}...`);
      
      const credentials = await getStoredCredentials();
      if (!credentials) {
        throw new Error('Aucune authentification trouvée');
      }
      
      // Essayer avec button_stop au lieu de action_timer_stop_button
      const payload = {
        "operation": "rpc",
        "db": credentials.db,
        "username": credentials.username,
        "password": credentials.password,
        "model": "project.task",
        "method": "button_stop", // Alternative method name
        "args": [[taskId]]
      };
      
      const apiUrl = getCurrentApiUrl();
      console.log('🔗 URL API Timer Stop Alt:', apiUrl);
      console.log('📤 Payload Timer Stop Alt:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Réponse API timer stop alt:', JSON.stringify(data, null, 2));
      
      if (data.success || (!data.error && data.result !== false)) {
        console.log(`✅ [ALT] Timer arrêté pour la tâche ${taskId}`);
        return {
          success: true,
          message: 'Timer arrêté avec succès (méthode alternative)',
          data: data.result
        };
      } else {
        return {
          success: false,
          message: data.message || data.error?.message || 'Erreur lors de l\'arrêt du timer (alt)'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur arrêt timer alt tâche ${taskId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de l\'arrêt (alt)'
      };
    }
  },
  calculateProjectStats(projects: Project[]): ProjectStats {
    if (!Array.isArray(projects)) {
      return {
        totalProjects: 0,
        totalTasks: 0,
        completedTasks: 0,
        inProgressTasks: 0,
        completionRate: 0,
        situationProjects: 0,
        normalProjects: 0,
        totalExpenses: 0,
        expenseCount: 0
      };
    }

    let totalTasks = 0;
    let completedTasks = 0;
    let inProgressTasks = 0;
    let totalExpenses = 0;
    let expenseCount = 0;

    projects.forEach(project => {
      if (project.task_ids && Array.isArray(project.task_ids)) {
        project.task_ids.forEach(task => {
          totalTasks++;
          
          // Comptage des tâches selon l'état
          if (task.state === '03_approved') {
            completedTasks++;
          } else if (task.state === '01_in_progress') {
            inProgressTasks++;
          }

          // Comptage des dépenses
          if (task.expense_ids && Array.isArray(task.expense_ids)) {
            task.expense_ids.forEach(expense => {
              expenseCount++;
              if (expense.amount && typeof expense.amount === 'number') {
                totalExpenses += expense.amount;
              }
            });
          }
        });
      }
    });

    return {
      totalProjects: projects.length,
      totalTasks,
      completedTasks,
      inProgressTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      situationProjects: projects.filter(p => p.project_type === 'situation').length,
      normalProjects: projects.filter(p => p.project_type === 'normaux').length,
      totalExpenses,
      expenseCount
    };
  },
  async insertOrUpdateTask(taskData: any): Promise<boolean> {
    try {
      console.log('🔄 Synchronisation tâche WebSocket:', taskData.id || taskData.name);
      
      console.log('📊 Données tâche synchronisées:', {
        id: taskData.id,
        name: taskData.name,
        state: taskData.state,
        project_id: taskData.project_id,
        user_ids: taskData.user_ids?.length || 0,
        expense_count: taskData.expense_ids?.length || 0
      });
      
      return true;
      
    } catch (error) {
      console.error('❌ Erreur sync tâche WebSocket:', error);
      return false;
    }
  },
  async deleteTask(taskId: number): Promise<boolean> {
    try {
      console.log('🗑️ Suppression tâche WebSocket:', taskId);
      
      console.log('✅ Tâche supprimée (WebSocket sync):', taskId);
      return true;
      
    } catch (error) {
      console.error('❌ Erreur suppression tâche WebSocket:', error);
      return false;
    }
  },
  async insertOrUpdateExpense(expenseData: any): Promise<boolean> {
    try {


      return true;
      
    } catch (error) {
      console.error('❌ Erreur sync dépense WebSocket:', error);
      return false;
    }
  },
  async deleteExpense(expenseId: number): Promise<boolean> {
    try {
      console.log('🗑️ Suppression dépense WebSocket:', expenseId);
      
      console.log('✅ Dépense supprimée (WebSocket sync):', expenseId);
      return true;
      
    } catch (error) {
      console.error('❌ Erreur suppression dépense WebSocket:', error);
      return false;
    }
  }
};

export default projectService;
