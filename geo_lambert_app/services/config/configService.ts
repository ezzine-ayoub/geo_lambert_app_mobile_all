import authStorageService from '../authStorageService';

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
            employee_id: number; // 🆕 Employee ID de l'utilisateur
            expense_account_id: number; // 🆕 Caisse ID de l'utilisateur
            expense_type_id: number;
            expense_category_id: number;
            amount: number;
            description: string;
            date: string; // ✅ Date de la dépense sélectionnée dans le popup
        }
    ): RPCPayload => ({
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'hr.expense.account.move',
        method: 'create',
        kwargs: {
            vals: {
                name: "New",
                employee_id: expenseData.employee_id,
                expense_account_id: expenseData.expense_account_id,
                task_id: taskId,
                expense_category_id: expenseData.expense_category_id,
                expense_type_id: expenseData.expense_type_id,
                total_amount: expenseData.amount,
                description: expenseData.description,
                date: expenseData.date, // ✅ Date sélectionnée dans le popup (format YYYY-MM-DD)
                expense_move_type: 'spent'
            }
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

        // Sauvegarder la configuration
        await authStorageService.save('geo_lambert_server_config', {
            baseUrl,
            wsUrl,
            apiUrl: DYNAMIC_CONFIG.API_URL,
            configured_at: Date.now()
        });

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

        // Sauvegarder la configuration complète
        await authStorageService.save('geo_lambert_server_config', {
            serverUrl,
            baseUrl,
            wsUrl,
            apiUrl: DYNAMIC_CONFIG.API_URL,
            configured_at: Date.now()
        });

    } catch (error) {
        console.error('❌ Erreur lors de la mise à jour de la config Geo Lambert:', error);
    }
};

/**
 * 📥 Charge la configuration depuis le storage
 */
export const loadServerConfig = async () => {
    try {
        const storedConfig = await authStorageService.get('geo_lambert_server_config');
        if (storedConfig) {
            const config = storedConfig;
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
        case_id: number;
        employee_id: string;
        id: number;
        uid: number;
        user_name: string;
        user_login: string;
        balance:number;
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

export const PROJECT_PAYLOADS = {
    /**
     * Démarre la tache d'une tâche (crée une ligne analytique avec start_datetime)
     * unit_amount sera calculé automatiquement par Odoo lors du stop (stop_datetime - start_datetime)
     */
    startTask: (
        credentials: PayloadCredentials,
        taskId: number,
        employeeId: number,
        projectId: number,
        accountId?: number, // ✅ Optionnel maintenant
        gpsData?: { latitude: string; longitude: string; address?: string }
    ): RPCPayload => ({
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'account.analytic.line',
        method: 'create',
        kwargs: {
            vals: {
                task_id: taskId,
                employee_id: employeeId,
                project_id: projectId,
                ...(accountId && { account_id: accountId }), // ✅ Conditionnel
                name: `Task ${new Date().toLocaleString('fr-FR')}`,
                date: new Date().toISOString().split('T')[0], // Date format YYYY-MM-DD
                start_datetime: CONFIG_UTILS.formatOdooDatetime(), // ✅ Format Odoo: YYYY-MM-DD HH:MM:SS
                stop_datetime: CONFIG_UTILS.formatOdooDatetime(), // ✅ Format Odoo: YYYY-MM-DD HH:MM:SS
                // unit_amount sera calculé automatiquement lors du stop
                ...(gpsData && {
                    start_latitude: gpsData.latitude,
                    start_longitude: gpsData.longitude
                    // ❌ address n'existe pas dans account.analytic.line
                })
            }
        }
    }),

    /**
     * Arrête la tache (met à jour la ligne analytique avec stop_datetime)
     * Odoo calculera automatiquement unit_amount = (stop_datetime - start_datetime) en heures
     */
    stopTask: (
        credentials: PayloadCredentials,
        lineId: number,
        gpsData?: { latitude: string; longitude: string; address?: string }
    ): RPCPayload => ({
        operation: 'rpc',
        db: credentials.db,
        username: credentials.username,
        password: credentials.password,
        model: 'account.analytic.line',
        method: 'write',
        args: [[lineId]],
        kwargs: {
            vals: {
                stop_datetime: CONFIG_UTILS.formatOdooDatetime(), // ✅ Format Odoo: YYYY-MM-DD HH:MM:SS
                ...(gpsData && {
                    stop_latitude: gpsData.latitude,
                    stop_longitude: gpsData.longitude
                })
            }
        }
    }),

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
     * Convertit une date JavaScript en format Odoo datetime
     * Format Odoo: 'YYYY-MM-DD HH:MM:SS' (sans timezone)
     */
    formatOdooDatetime: (date: Date = new Date()): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    },

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
