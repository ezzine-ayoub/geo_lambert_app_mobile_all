import AsyncStorage from '@react-native-async-storage/async-storage';

// ==================== CONFIGURATION API GEO LAMBERT ====================

// Configuration dynamique
let DYNAMIC_CONFIG = {
    API_URL: '',
    WS_URL: '',
    DEFAULT_DB: 'odoo',
    TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
    isInitialized: false
};

// ==================== INTERFACES POUR LA CONFIGURATION SERVEUR ====================

export interface ServerConfigResponse {
    success: boolean;
    show: boolean;
    form: {
        baseUrl: string;
        wsUrl: string;
    };
    odoo_version: string;
    api_version: string;
}

// ==================== FONCTIONS DE GESTION DE CONFIGURATION ====================

/**
 * 💰 Payloads pour la gestion des dépenses
 */
export const EXPENSE_PAYLOADS = {
  /**
   * Crée une nouvelle dépense
   */
  createExpense: (
    credentials: PayloadCredentials, 
    taskId: number, 
    expenseData: {
      user_id: number;
      expense_type: string;
      amount: number;
      description: string;
      expense_date?: string;
    }
  ): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'task.expense',
    method: 'create',
    kwargs: {
      vals: {
        user_id: expenseData.user_id,
        task_id: taskId,
        expense_type: expenseData.expense_type,
        amount: expenseData.amount,
        description: expenseData.description,
        expense_date: expenseData.expense_date || new Date().toISOString().split('T')[0]
      }
    }
  })
};

/**
 * 📊 Payloads pour la gestion des lignes analytiques (timesheets)
 */
export const ANALYTIC_LINE_PAYLOADS = {
  /**
   * Crée une nouvelle ligne analytique (démarrer une tâche)
   */
  createAnalyticLine: (credentials: PayloadCredentials, taskId: number, userAuth: number = 1): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'account.analytic.line',
    method: 'create',
    kwargs: {
      vals: {
        employee_id: userAuth,
        task_id: taskId
      }
    }
  }),
  editAnalyticLine: (credentials: PayloadCredentials, taskId: number, userAuth: number = 1): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'account.analytic.line',
    method: 'write',
    kwargs: {
      domain:[["employee_id","=", userAuth],["task_id","=",taskId],["unit_amount","=",0]],
      vals: {
        employee_id: userAuth,
        task_id: taskId,
        unit_amount: 10.00,
      }
    }
  })
};

/**
 * 📋 Payloads pour la gestion des projets
 */
export const PROJECT_PAYLOADS = {
  /**
   * Récupère tous les projets avec leurs tâches et dépenses
   */
  getAllProjects: (credentials: PayloadCredentials): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.project',
    method: 'search_read',
    kwargs: {
      domain: [],
      fields: [
        'name',
        'project_type',
        'partner_id',
        'date_start',
        'date',
        'task_ids',
        'numero'
      ],
      replaceToObject: [{
        'partner_id': {
          'res.partner': ['name', 'street']
        },
        'task_ids': {
          'project.task': [
            'name',
            'state',
            'partner_id',
            'user_ids',
            'expense_ids',
            'timer_start',
          ]
        },
        'task_ids.partner_id': {
          'res.partner': ['name', 'street']
        },
        'task_ids.user_ids': {
          'res.users': ['name']
        },
        'task_ids.expense_ids': {
          'task.expense': [
            'amount',
            'expense_date',
            'expense_type',
            'project_id',
            'task_id',
            'currency_id',
            'display_name'
          ]
        }
      }]
    }
  }),

  /**
   * Récupère un projet spécifique par ID
   */
  getProjectById: (credentials: PayloadCredentials, projectId: number): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.project',
    method: 'search_read',
    kwargs: {
      domain: [['id', '=', projectId]],
      fields: [
        'name',
        'project_type',
        'partner_id',
        'date_start',
        'date',
        'task_ids',
        'numero'
      ]
    }
  }),

  /**
   * Récupère les projets par type
   */
  getProjectsByType: (credentials: PayloadCredentials, projectType: string): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.project',
    method: 'search_read',
    kwargs: {
      domain: [['project_type', '=', projectType]],
      fields: [
        'name',
        'project_type',
        'partner_id',
        'date_start',
        'date',
        'task_ids',
        'numero'
      ]
    }
  })
};

/**
 * 📋 Payloads pour la gestion des tâches
 */
export const TASK_PAYLOADS = {
  /**
   * Récupère toutes les tâches
   */
  getAllTasks: (credentials: PayloadCredentials): RPCPayload => ({
    db: credentials.db,
    operation: 'rpc',
    username: credentials.username,
    password: credentials.password,
    model: 'project.task',
    method: 'search_read',
    kwargs: {
      domain: [],
      fields: [
        'name',
        'date_deadline',
        'partner_id',
        'date_assign',
        'partner_name',
        'stage_id',
        'project_id',
        'is_stop_maintenance',
        'employee_id',
        'employee2_id',
        'change_technician',
        'partner_phone',
        'partner_address_complete',
        'state'
      ],
      order: 'date_deadline desc'
    }
  }),

  /**
   * Récupère les tâches par état
   */
  getTasksByState: (credentials: PayloadCredentials, state: string): RPCPayload => ({
    db: credentials.db,
    operation: 'rpc',
    username: credentials.username,
    password: credentials.password,
    model: 'project.task',
    method: 'search_read',
    kwargs: {
      domain: [['state', '=', state]],
      fields: [
        'name',
        'date_deadline',
        'partner_id',
        'date_assign',
        'partner_name',
        'stage_id',
        'project_id',
        'is_stop_maintenance',
        'employee_id',
        'employee2_id',
        'change_technician',
        'partner_phone',
        'partner_address_complete',
        'state'
      ],
      order: 'date_deadline desc',
      limit: 50
    }
  }),

  /**
   * Démarre le timer d'une tâche
   */
  startTimer: (credentials: PayloadCredentials, taskId: number): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.task',
    method: 'action_timer_start_button',
    args: [[taskId]]
  }),

  /**
   * Met en pause le timer d'une tâche
   */
  pauseTimer: (credentials: PayloadCredentials, taskId: number): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.task',
    method: 'action_timer_pause_button',
    args: [[taskId]]
  }),

  /**
   * Reprend le timer d'une tâche
   */
  resumeTimer: (credentials: PayloadCredentials, taskId: number): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.task',
    method: 'action_timer_resume_button',
    args: [[taskId]]
  }),

  /**
   * Arrête le timer d'une tâche
   */
  stopTimer: (credentials: PayloadCredentials, taskId: number): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.task',
    method: 'action_timer_stop_button',
    args: [[taskId]]
  }),

  /**
   * Récupère l'état du timer d'une tâche
   */
  getTimerState: (credentials: PayloadCredentials, taskId: number): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'project.task',
    method: 'read',
    args: [[taskId]],
    kwargs: {
      fields: ['id', 'name', 'is_timer_running', 'timer_pause', 'timer_start', 'effective_hours']
    }
  })
};

/**
 * 🔍 Récupère la configuration du serveur
 */
export const fetchServerConfig = async (serverUrl: string): Promise<ServerConfigResponse> => {
    try {
        const cleanUrl = CONFIG_UTILS.formatServerUrl(serverUrl);
        const configUrl = `${cleanUrl}/config`;
        
        console.log('🔍 Récupération config serveur:', configUrl);
        
        const response = await fetch(configUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({}),
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const config = await response.json();
        
        console.log('✅ Configuration serveur récupérée:', config);
        
        if (!config.success) {
            throw new Error('Configuration serveur invalide');
        }
        
        if (!config.form || !config.form.baseUrl) {
            throw new Error('BaseURL manquant dans la configuration');
        }
        
        return config;
        
    } catch (error) {
        console.error('❌ Erreur récupération config serveur:', error);
        throw error;
    }
};

/**
 * 🔄 Met à jour la configuration du serveur avec baseUrl et wsUrl
 */
export const updateServerConfig = async (baseUrl: string, wsUrl: string) => {
    try {
        DYNAMIC_CONFIG.API_URL = `${baseUrl}/odoo-rpc`;
        DYNAMIC_CONFIG.WS_URL = wsUrl;
        DYNAMIC_CONFIG.isInitialized = true;
        
        console.log('✅ Configuration Geo Lambert mise à jour:', {
            API_URL: DYNAMIC_CONFIG.API_URL,
            WS_URL: DYNAMIC_CONFIG.WS_URL
        });
        
        // Sauvegarder la configuration
        await AsyncStorage.setItem('geo_lambert_server_config', JSON.stringify({
            baseUrl,
            wsUrl,
            apiUrl: DYNAMIC_CONFIG.API_URL,
            configured_at: Date.now()
        }));
        
    } catch (error) {
        console.error('❌ Erreur lors de la mise à jour de la config Geo Lambert:', error);
    }
};

/**
 * 🔄 Met à jour la configuration avec les URLs correctes depuis la réponse du serveur
 */
export const updateServerConfigFromServerResponse = async (serverUrl: string, baseUrl: string, wsUrl: string) => {
    try {
        // Utiliser le baseUrl de la réponse serveur pour l'API
        DYNAMIC_CONFIG.API_URL = `${baseUrl}/odoo-rpc`;
        DYNAMIC_CONFIG.WS_URL = wsUrl;
        DYNAMIC_CONFIG.isInitialized = true;
        
        console.log("=============== CONFIGURATION URLS ===============");
        console.log("Server URL (input):", serverUrl);
        console.log("Base URL (from config):", baseUrl);
        console.log("WebSocket URL (from config):", wsUrl);
        console.log("Final API URL:", DYNAMIC_CONFIG.API_URL);
        console.log("Final WS URL:", DYNAMIC_CONFIG.WS_URL);
        console.log("=================================================");
        
        // Sauvegarder la configuration complète
        await AsyncStorage.setItem('geo_lambert_server_config', JSON.stringify({
            serverUrl,
            baseUrl,
            wsUrl,
            apiUrl: DYNAMIC_CONFIG.API_URL,
            configured_at: Date.now()
        }));
        
    } catch (error) {
        console.error('❌ Erreur lors de la mise à jour de la config Geo Lambert:', error);
    }
};

/**
 * 📥 Charge la configuration depuis le storage
 */
export const loadServerConfig = async () => {
    try {
        const storedConfig = await AsyncStorage.getItem('geo_lambert_server_config');
        if (storedConfig) {
            const config = JSON.parse(storedConfig);
            if (config.baseUrl && config.wsUrl) {
                await updateServerConfig(config.baseUrl, config.wsUrl);
                console.log('✅ Configuration Geo Lambert chargée depuis le storage:', {
                    baseUrl: config.baseUrl,
                    wsUrl: config.wsUrl
                });
                return true;
            }
        }
    } catch (error) {
        console.error('❌ Erreur lors du chargement de la config Geo Lambert:', error);
    }
    return false;
};

/**
 * 🔗 Obtient l'URL API actuelle
 */
export const getCurrentApiUrl = () => {
    if (!DYNAMIC_CONFIG.isInitialized || !DYNAMIC_CONFIG.API_URL) {
        throw new Error('URL API non configurée. Configurez le serveur d\'abord.');
    }
    return DYNAMIC_CONFIG.API_URL;
};

/**
 * 🔗 Obtient l'URL WebSocket actuelle pour Geo Lambert
 */
export const getCurrentWebSocketUrl = () => {
    if (!DYNAMIC_CONFIG.isInitialized || !DYNAMIC_CONFIG.WS_URL) {
        throw new Error('URL WebSocket non configurée. Configurez le serveur d\'abord.');
    }
    return DYNAMIC_CONFIG.WS_URL;
};

// ==================== INTERFACES POUR VOTRE API ====================

export interface BasePayload {
    operation: string;
    db: string;
    username: string;
    password: string;
}

export interface AuthPayload extends BasePayload {
    operation: 'auth';
}

export interface RPCPayload extends BasePayload {
    operation: 'rpc';
    model: string;
    method: string;
    args?: any[];
    kwargs?: {
        domain?: any[];
        fields?: string[];
        limit?: number;
        offset?: number;
        order?: string;
        replaceToObject?: any[];
        vals?: any;
        with_fields?: boolean;
        [key: string]: any;
    };
}

export interface PayloadCredentials {
    db: string;
    username: string;
    password: string;
}

// Interface pour votre réponse d'auth
export interface CustomAuthResponse {
    success: boolean;
    message: string;
    user_info: {
        id: number;
        uid: number;
        user_name: string;
        user_login: string;
        active: boolean;
        email: string;
        phone: string;
        mobile?: string;
        website: boolean;
        partner_id: number;
        partner_name: string;
        street: string;
        street2?: string;
        city: string;
        state_id: string;
        country_id: string;
        zip: string;
        company_id: number;
        company_name: string;
        is_company: boolean;
        function?: string;
        title?: string;
        lang: string;
        tz: string;
        category_id: any[];
        is_admin: boolean;
        groups: string[];
        image_url: string;
        create_date: string;
        login_date: string;
        signature: string;
        notification_type: string;
        username: string;
        display_name: string;
    };
    timestamp: string;
}

// ==================== PAYLOADS POUR VOTRE API ====================

/**
 * 🔐 Payload pour l'authentification avec votre API
 */
export const AUTH_PAYLOADS = {
    /**
     * Authentification avec votre format personnalisé
     */
    authenticate: (username: string, password: string, db: string = 'odoo'): AuthPayload => ({
        db,
        operation: 'auth',
        username,
        password
    })
};

/**
 * 🏊‍♀️ Payloads pour la gestion des piscines
 */
export const PISCINE_PAYLOADS = {
    /**
     * Récupère toutes les piscines
     */
    getAllPiscines: (credentials: PayloadCredentials): RPCPayload => ({
        db: credentials.db,
        operation: 'rpc',
        username: credentials.username,
        password: credentials.password,
        model: 'piscine.piscine',
        method: 'search_read',
        kwargs: {
            domain: [],
            fields: [
                'id', 'name', 'client_id', 'adresse', 'ville',
                'type_piscine', 'longueur', 'largeur', 'profondeur',
                'volume', 'date_installation', 'statut', 'notes',
                'create_date', 'write_date'
            ],
            order: 'name asc'
        }
    }),

    /**
     * Récupère les interventions
     */
    getInterventions: (credentials: PayloadCredentials, piscineId?: number): RPCPayload => ({
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'piscine.intervention',
        method: 'search_read',
        kwargs: {
            domain: piscineId ? [['piscine_id', '=', piscineId]] : [],
            fields: [
                'id', 'name', 'date_intervention', 'type_intervention',
                'technicien_id', 'statut', 'description', 'duree',
                'cout', 'piscine_id', 'create_date', 'write_date'
            ],
            order: 'date_intervention desc'
        }
    }),

    /**
     * Crée une nouvelle intervention
     */
    createIntervention: (
        credentials: PayloadCredentials,
        interventionData: {
            piscine_id: number;
            type_intervention: string;
            date_intervention: string;
            technicien_id?: number;
            description?: string;
            duree?: number;
            cout?: number;
        }
    ): RPCPayload => ({
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'piscine.intervention',
        method: 'create',
        kwargs: {
            with_fields: true,
            fields: ['id', 'name', 'statut', 'date_intervention'],
            vals: interventionData
        }
    })
};

/**
 * 👥 Payloads pour la gestion des clients
 */
export const CLIENT_PAYLOADS = {
    /**
     * Récupère tous les clients
     */
    getAllClients: (credentials: PayloadCredentials, limit: number = 1000): RPCPayload => ({
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'res.partner',
        method: 'search_read',
        kwargs: {
            domain: [['is_company', '=', false], ['customer_rank', '>', 0]],
            fields: [
                'id', 'name', 'email', 'phone', 'mobile',
                'street', 'street2', 'city', 'zip', 'state_id', 'country_id',
                'user_id', 'is_company', 'customer_rank',
                'create_date', 'write_date'
            ],
            order: 'name asc',
            limit
        }
    }),

    /**
     * Recherche des clients
     */
    searchClients: (credentials: PayloadCredentials, searchTerm: string, limit: number = 50): RPCPayload => ({
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'res.partner',
        method: 'search_read',
        kwargs: {
            domain: [
                ['customer_rank', '>', 0],
                '|',
                ['name', 'ilike', searchTerm],
                ['email', 'ilike', searchTerm]
            ],
            fields: ['id', 'name', 'email', 'phone', 'city'],
            limit
        }
    })
};

// ==================== FONCTIONS UTILITAIRES ====================

export const CONFIG_UTILS = {
    /**
     * Headers par défaut pour votre API
     */
    createDefaultHeaders: (): Record<string, string> => ({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'GeoLambert-Mobile-App/1.0'
    }),

    /**
     * Validation d'URL
     */
    isValidUrl: (url: string): boolean => {
        try {
            new URL(url);
            return url.startsWith('http://') || url.startsWith('https://');
        } catch {
            return false;
        }
    },

    /**
     * Format de l'URL serveur
     */
    formatServerUrl: (url: string): string => {
        if (!url) return '';
        
        url = url.trim();
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        return url.replace(/\/$/, '');
    },

    /**
     * Valide un payload
     */
    validatePayload: (payload: any): boolean => {
        const requiredFields = ['operation', 'db', 'username', 'password'];
        return requiredFields.every(field => payload.hasOwnProperty(field));
    }
};

// ==================== INITIALISATION ====================

/**
 * 🚀 Initialise la configuration Geo Lambert au démarrage
 */
export const initializeConfig = async () => {
    const loaded = await loadServerConfig();
    if (!loaded) {
        console.log('⚠️ Aucune configuration sauvegardée trouvée.');
        console.log('👉 Vous devez configurer un serveur via l\'interface de connexion.');
    }
    return loaded;
};

// Auto-initialisation
initializeConfig();
