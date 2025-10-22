// AuthService - Pour votre API personnalisée Odoo-RPC
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  AUTH_PAYLOADS, 
  CONFIG_UTILS, 
  getCurrentApiUrl,
  updateServerConfig,
  updateServerConfigFromServerResponse,
  fetchServerConfig,
  initializeConfig,
  TASK_PAYLOADS,
  type PayloadCredentials,
  type CustomAuthResponse,
  type ServerConfigResponse
} from "./config/configService";

// Interface pour la session stockée
interface UserAuthSession {
  success: boolean;
  user_info: AuthUser;
  CREDENTIALS: {
    username: string;
    password: string;
  };
  db: string;
  server_url: string;
  timestamp: number;
}

export interface AuthUser {
  id: number;
  uid: number;
  display_name: string;
  username: string;
  user_name: string;
  email: string;
  phone?: string;
  mobile?: string;
  partner_name: string;
  city?: string;
  company_name?: string;
  is_admin?: boolean;
  image_url?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  user_info: AuthUser;
  CREDENTIALS?: {
    username: string;
    password: string;
  };
}

export interface LoginCredentials {
  username: string;
  password: string;
  db: string;
  server_url: string;
}

// Configuration AsyncStorage
const SESSION_EXPIRY_HOURS = 24;
const STORAGE_KEYS = {
  SESSION: '@geo_lambert_session_v4',
  CREDENTIALS: '@geo_lambert_credentials_v4',
  USER_INFO: '@geo_lambert_user_info_v4',
  SERVER_CONFIG: '@geo_lambert_server_config'
};

// ==================== STORAGE HELPERS ====================

async function saveToAsyncStorage(key: string, value: any): Promise<boolean> {
  try {
    const dataToStore = {
      data: value,
      timestamp: Date.now(),
      version: '4.0'
    };
    
    await AsyncStorage.setItem(key, JSON.stringify(dataToStore));
    return true;
    
  } catch (error) {
    console.error(`❌ Erreur sauvegarde AsyncStorage ${key}:`, error);
    return false;
  }
}

async function getFromAsyncStorage(key: string): Promise<any | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    
    if (!stored) {
      return null;
    }
    
    const parsed = JSON.parse(stored);
    
    // Vérifier l'expiration
    const isExpired = (Date.now() - parsed.timestamp) > (SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
    
    if (isExpired) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    
    return parsed.data;
    
  } catch (error) {
    console.error(`❌ Erreur récupération AsyncStorage ${key}:`, error);
    return null;
  }
}

// ==================== INTERFACES POUR LES TÂCHES ====================

export interface ProjectTask {
  id: number;
  name: string;
  date_deadline: string | false;
  partner_id: [number, string] | false;
  date_assign: string | false;
  partner_name: string | false;
  stage_id: [number, string] | false;
  project_id: [number, string] | false;
  is_stop_maintenance: boolean;
  employee_id: [number, string] | false;
  employee2_id: [number, string] | false;
  change_technician: boolean;
  partner_phone: string | false;
  partner_address_complete: string | false;
  state: string;
  timer_state: string;
}

export interface TasksResponse {
  success: boolean;
  data: ProjectTask[];
  message?: string;
}

// ==================== SERVICE D'AUTHENTIFICATION ====================

export const authService = {
  /**
   * ✅ ÉTAPE 1: Récupération de la configuration serveur
   */
  async fetchAndConfigureServer(serverUrl: string): Promise<{ success: boolean; config?: ServerConfigResponse; error?: string }> {
    try {
      const cleanUrl = CONFIG_UTILS.formatServerUrl(serverUrl);
      
      if (!CONFIG_UTILS.isValidUrl(cleanUrl)) {
        throw new Error('URL de serveur invalide');
      }

      console.log('🔍 Étape 1: Récupération config serveur...', cleanUrl);
      
      // Récupérer la configuration depuis le serveur
      const serverConfig = await fetchServerConfig(cleanUrl);
      
      if (!serverConfig.success || !serverConfig.form.baseUrl) {
        throw new Error('Configuration serveur invalide ou baseUrl manquant');
      }
      
      // Mettre à jour la configuration avec le baseUrl et wsUrl récupérés
      await updateServerConfigFromServerResponse(
        cleanUrl, 
        serverConfig.form.baseUrl, 
        serverConfig.form.wsUrl
      );
      await saveToAsyncStorage(STORAGE_KEYS.SERVER_CONFIG, {
        server_url: cleanUrl,
        base_url: serverConfig.form.baseUrl,
        ws_url: serverConfig.form.wsUrl,
        odoo_version: serverConfig.odoo_version,
        api_version: serverConfig.api_version,
        configured_at: Date.now()
      });

      console.log('✅ Étape 1 terminée - Serveur configuré:', {
        serverUrl: cleanUrl,
        baseUrl: serverConfig.form.baseUrl
      });
      
      return { success: true, config: serverConfig };

    } catch (error) {
      console.error('❌ Erreur configuration serveur:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur de configuration serveur'
      };
    }
  },

  // ==================== MÉTHODES POUR LES TÂCHES ====================

  /**
   * ✅ RÉCUPÉRATION: Toutes les tâches
   */
  async getTasks(): Promise<TasksResponse> {
    try {
      console.log('📋 Récupération des tâches...');
      
      const response = await executePayloadWithStoredAuth(
        (credentials) => TASK_PAYLOADS.getAllTasks(credentials)
      );
      
      console.log('🔍 Réponse API reçue:', {
        hasResponse: !!response,
        hasSuccess: response?.success,
        hasResult: !!response?.result,
        isResultArray: Array.isArray(response?.result),
        resultLength: response?.result?.length || 0
      });
      
      // Nouveau format API: { success: true, result: [...], operation_info: {...}, timestamp: '...' }
      if (response && response.success === true && Array.isArray(response.result)) {
        console.log(`✅ ${response.result.length} tâches récupérées (nouveau format)`);
        return {
          success: true,
          data: response.result
        };
      }
      // Ancien format: array direct ou { data: [...] }
      else if (response && Array.isArray(response)) {
        console.log(`✅ ${response.length} tâches récupérées (format array direct)`);
        return {
          success: true,
          data: response
        };
      }
      // Format avec data property
      else if (response && response.data && Array.isArray(response.data)) {
        console.log(`✅ ${response.data.length} tâches récupérées (format data property)`);
        return {
          success: true,
          data: response.data
        };
      }
      else {
        console.warn('⚠️ Réponse inattendue pour les tâches:', response);
        return {
          success: false,
          data: [],
          message: `Format de réponse inattendu: ${response ? JSON.stringify(Object.keys(response)) : 'null'}`
        };
      }
      
    } catch (error) {
      console.error('❌ Erreur récupération tâches:', error);
      return {
        success: false,
        data: [],
        message: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  },

  /**
   * ✅ RÉCUPÉRATION: Tâches par état
   */
  async getTasksByState(state: string): Promise<TasksResponse> {
    try {
      console.log(`📋 Récupération des tâches avec état: ${state}`);
      
      const result = await executePayloadWithStoredAuth(
        (credentials) => TASK_PAYLOADS.getTasksByState(credentials, state)
      );
      
      if (result && Array.isArray(result)) {
        console.log(`✅ ${result.length} tâches récupérées pour l'état ${state}`);
        return {
          success: true,
          data: result
        };
      } else {
        return {
          success: false,
          data: [],
          message: 'Format de réponse inattendu'
        };
      }
      
    } catch (error) {
      console.error(`❌ Erreur récupération tâches par état ${state}:`, error);
      return {
        success: false,
        data: [],
        message: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  },

  /**
   * ✅ ÉTAPE 2: AUTHENTIFICATION avec votre API personnalisée (Flow complet en 2 étapes)
   */
  async authenticate(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      // ÉTAPE 1: Configurer le serveur et récupérer la configuration
      console.log('🚀 Début authentification en 2 étapes...');
      const configResult = await this.fetchAndConfigureServer(credentials.server_url);
      
      if (!configResult.success) {
        return {
          success: false,
          message: configResult.error || 'Impossible de configurer le serveur',
          user_info: {} as AuthUser
        };
      }
      
      console.log('✅ Étape 1 terminée - Configuration récupérée');

      // ÉTAPE 2: Authentification avec le baseUrl récupéré
      console.log('🔐 Étape 2: Authentification...');
      
      // Créer le payload pour votre API
      const authPayload = AUTH_PAYLOADS.authenticate(
        credentials.username,
        credentials.password,
        credentials.db
      );

      console.log('🔐 Payload d\'authentification:', authPayload);

      // Utiliser l'URL API configurée depuis la réponse du serveur
      const apiUrl = getCurrentApiUrl();
      console.log('🔗 URL API pour auth:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: CONFIG_UTILS.createDefaultHeaders(),
        body: JSON.stringify(authPayload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: CustomAuthResponse = await response.json();

      console.log('📥 Réponse authentification reçue:', data);

      // Gestion de votre format de réponse
      if (data.success) {
        const authResponse: AuthResponse = {
          success: true,
          message: data.message || 'Connexion réussie',
          user_info: {
            id: data.user_info.id,
            uid: data.user_info.uid,
            display_name: data.user_info.display_name,
            username: data.user_info.username,
            user_name: data.user_info.user_name,
            email: data.user_info.email,
            phone: data.user_info.phone,
            mobile: data.user_info.mobile,
            partner_name: data.user_info.partner_name,
            city: data.user_info.city,
            company_name: data.user_info.company_name,
            is_admin: data.user_info.is_admin,
            image_url: data.user_info.image_url
          },
          CREDENTIALS: {
            username: credentials.username,
            password: credentials.password
          }
        };

        // Sauvegarder les données
        try {
          await this.saveAuthData(authResponse, credentials.db, credentials.server_url);
          await this.saveCredentials({
            username: credentials.username,
            password: credentials.password,
            db: credentials.db,
            server_url: credentials.server_url
          });

          console.log('✅ Données d\'authentification sauvegardées');
        } catch (saveError) {
          console.warn('⚠️ Erreur sauvegarde après auth:', saveError);
        }

        console.log('🎉 Authentification complète terminée avec succès!');
        return authResponse;
      } else {
        console.warn('⚠️ Authentification échouée:', data.message);
        return {
          success: false,
          message: data.message || 'Identifiants incorrects',
          user_info: {} as AuthUser
        };
      }
      
    } catch (error) {
      console.error('❌ Erreur authenticate:', error);
      
      if (error instanceof Error && error.message.includes('fetch')) {
        return {
          success: false,
          message: 'Impossible de se connecter au serveur. Vérifiez l\'URL.',
          user_info: {} as AuthUser
        };
      }
      
      return {
        success: false,
        message: 'Erreur de connexion au serveur',
        user_info: {} as AuthUser
      };
    }
  },

  /**
   * ✅ SAUVEGARDE: AuthData
   */
  async saveAuthData(authData: AuthResponse, db: string, serverUrl: string): Promise<void> {
    try {
      const sessionData: UserAuthSession = {
        success: authData.success,
        user_info: authData.user_info,
        CREDENTIALS: authData.CREDENTIALS || { username: '', password: '' },
        db,
        server_url: serverUrl,
        timestamp: Date.now()
      };
      
      await saveToAsyncStorage(STORAGE_KEYS.SESSION, sessionData);
    } catch (error) {
      console.error('❌ Erreur saveAuthData:', error);
      throw error;
    }
  },

  /**
   * ✅ SAUVEGARDE: Credentials
   */
  async saveCredentials(credentials: { 
    username: string; 
    password: string; 
    db: string;
    server_url: string;
  }): Promise<void> {
    try {
      await saveToAsyncStorage(STORAGE_KEYS.CREDENTIALS, credentials);
    } catch (error) {
      console.error('❌ Erreur saveCredentials:', error);
      throw error;
    }
  },

  /**
   * ✅ RÉCUPÉRATION: Credentials
   */
  async getStoredCredentials(): Promise<{ 
    username: string; 
    password: string; 
    db: string;
    server_url: string;
  } | null> {
    try {
      const credentials = await getFromAsyncStorage(STORAGE_KEYS.CREDENTIALS);
      
      if (credentials && credentials.username && credentials.password && credentials.server_url) {
        return credentials;
      }
      
      const sessionData = await getFromAsyncStorage(STORAGE_KEYS.SESSION);
      
      if (sessionData && sessionData.CREDENTIALS && sessionData.CREDENTIALS.username) {
        return {
          username: sessionData.CREDENTIALS.username,
          password: sessionData.CREDENTIALS.password,
          db: sessionData.db || 'smile_piscine',
          server_url: sessionData.server_url || ''
        };
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ Erreur getStoredCredentials:', error);
      return null;
    }
  },

  /**
   * ✅ VÉRIFICATION: Session authentifiée
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const credentials = await this.getStoredCredentials();
      
      if (credentials && credentials.username && credentials.password && credentials.server_url) {
        // Reconfigurer le serveur avec updateServerConfig simple
        try {
          const serverConfig = await getFromAsyncStorage(STORAGE_KEYS.SERVER_CONFIG);
          if (serverConfig && serverConfig.base_url && serverConfig.ws_url) {
            await updateServerConfig(serverConfig.base_url, serverConfig.ws_url);
          } else {
            // Fallback: essayer de récupérer la config depuis le serveur
            console.log('⚠️ Config manquante, tentative de récupération depuis le serveur...');
            const configResult = await this.fetchAndConfigureServer(credentials.server_url);
            if (!configResult.success) {
              throw new Error('Configuration serveur impossible');
            }
          }
        } catch (configError) {
          console.warn('⚠️ Erreur reconfiguration dans isAuthenticated:', configError);
        }
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ Erreur isAuthenticated:', error);
      return false;
    }
  },

  /**
   * ✅ RÉCUPÉRATION: Données d'auth
   */
  async getStoredAuthData(): Promise<AuthResponse | null> {
    try {
      const sessionData = await getFromAsyncStorage(STORAGE_KEYS.SESSION);
      
      if (sessionData && sessionData.user_info) {
        if (sessionData.server_url) {
          try {
            const serverConfig = await getFromAsyncStorage(STORAGE_KEYS.SERVER_CONFIG);
            if (serverConfig && serverConfig.base_url && serverConfig.ws_url) {
              await updateServerConfig(serverConfig.base_url, serverConfig.ws_url);
            } else {
              // Fallback: récupérer la config depuis le serveur
              console.log('⚠️ Config manquante, tentative de récupération depuis le serveur...');
              const configResult = await this.fetchAndConfigureServer(sessionData.server_url);
              if (!configResult.success) {
                console.warn('⚠️ Impossible de récupérer la config serveur');
              }
            }
          } catch (configError) {
            console.warn('⚠️ Erreur reconfiguration dans getStoredAuthData:', configError);
          }
        }

        return {
          success: sessionData.success,
          message: 'Session active',
          user_info: sessionData.user_info,
          CREDENTIALS: sessionData.CREDENTIALS
        };
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ Erreur getStoredAuthData:', error);
      return null;
    }
  },

  /**
   * ✅ UTILISATEUR: Récupération
   */
  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      const authData = await this.getStoredAuthData();
      return authData?.user_info || null;
    } catch (error) {
      console.error('❌ Erreur getCurrentUser:', error);
      return null;
    }
  },

  /**
   * ✅ VÉRIFICATION: Session valide
   */
  async isSessionValid(): Promise<boolean> {
    try {
      const sessionData = await getFromAsyncStorage(STORAGE_KEYS.SESSION);
      const credentials = await this.getStoredCredentials();
      
      return (
        sessionData && 
        sessionData.success && 
        sessionData.user_info && 
        credentials && 
        credentials.username && 
        credentials.password
      );
      
    } catch (error) {
      console.error('❌ Erreur isSessionValid:', error);
      return false;
    }
  },

  /**
   * ✅ DÉCONNEXION: Nettoyage
   */
  async logout(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.SESSION,
        STORAGE_KEYS.CREDENTIALS,
        STORAGE_KEYS.USER_INFO,
        STORAGE_KEYS.SERVER_CONFIG
      ]);
      
      console.log('✅ Déconnexion réussie');
      
    } catch (error) {
      console.error('❌ Erreur logout:', error);
    }
  },

  /**
   * ✅ INITIALISATION: Au démarrage
   */
  async initializeAuth(): Promise<boolean> {
    try {
      await initializeConfig();
      
      const isAuth = await this.isAuthenticated();
      
      if (isAuth) {
        console.log('✅ Session utilisateur restaurée');
      } else {
        console.log('⚠️ Aucune session active');
      }
      
      return isAuth;
      
    } catch (error) {
      console.error('❌ Erreur initializeAuth:', error);
      return false;
    }
  },
};

// ==================== FONCTIONS GLOBALES ====================

export async function getStoredCredentials(): Promise<PayloadCredentials | null> {
  try {
    const credentials = await authService.getStoredCredentials();
    
    if (credentials) {
      return {
        db: credentials.db,
        username: credentials.username,
        password: credentials.password
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Erreur getStoredCredentials globale:', error);
    return null;
  }
}

export async function executePayloadWithStoredAuth(payloadFactory: (credentials: PayloadCredentials) => any) {
  try {
    const credentials = await getStoredCredentials();
    
    if (!credentials) {
      throw new Error('Aucune authentification trouvée');
    }

    const payload = payloadFactory(credentials);

    const apiUrl = getCurrentApiUrl();

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: CONFIG_UTILS.createDefaultHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();

  } catch (error) {
    console.error('❌ Erreur executePayloadWithStoredAuth:', error);
    throw error;
  }
}

// Auto-initialisation
authService.initializeAuth();
