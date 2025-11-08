// AuthStorageService - Stockage SQLite pour sessions illimitées (AVEC QUEUE)
import * as SQLite from 'expo-sqlite';

interface StorageRecord {
  key: string;
  value: string;
  timestamp: number;
  version: string;
}

// Interface pour les opérations en queue
interface QueueOperation {
  type: 'save' | 'remove' | 'clear';
  key?: string;
  value?: any;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

class AuthStorageService {
  private db: SQLite.SQLiteDatabase | null = null;
  private dbName = 'geo_lambert_auth.db';
  private version = '1.0';
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;
  
  // 🔒 Queue pour séquencer les opérations d'écriture
  private operationQueue: QueueOperation[] = [];
  private isProcessingQueue = false;
  
  // 💾 CACHE EN MÉMOIRE pour réduire les lectures
  private cache: Map<string, any> = new Map();

  // ==================== INITIALISATION ====================
  
  async initDatabase(): Promise<void> {
    // Si déjà initialisé, retourner immédiatement
    if (this.db) {
      return;
    }

    // Si en cours d'initialisation, attendre la promesse existante
    if (this.isInitializing && this.initPromise) {
      console.log('⏳ Initialisation déjà en cours, attente...');
      return this.initPromise;
    }

    // Marquer comme en cours d'initialisation
    this.isInitializing = true;

    // Créer la promesse d'initialisation
    this.initPromise = this._doInitDatabase();

    try {
      await this.initPromise;
    } finally {
      this.isInitializing = false;
      this.initPromise = null;
    }
  }

  private async _doInitDatabase(): Promise<void> {
    try {
      console.log('🔐 Ouverture base de données auth SQLite...');
      
      // Ouvrir la base de données (elle reste ouverte)
      // SQLite crée automatiquement le fichier s'il n'existe pas
      this.db = await SQLite.openDatabaseAsync(this.dbName);
      
      // 🚨 CRITIQUE: Attendre que SQLite soit complètement prêt
      // Petit délai pour éviter les locks sur les premières écritures
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Vérifier si la table existe déjà
      const tableCheck = await this.db.getFirstAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='auth_storage'"
      );
      
      if (tableCheck) {
        console.log('✅ Base de données auth déjà existante, connexion établie');
      } else {
        console.log('📦 Création de la structure de la base de données...');
        
        // Créer la table auth_storage seulement si elle n'existe pas
        await this.db.execAsync(`
          CREATE TABLE IF NOT EXISTS auth_storage (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            version TEXT NOT NULL
          );
        `);

        // Créer index pour performance
        await this.db.execAsync(`
          CREATE INDEX IF NOT EXISTS idx_auth_timestamp ON auth_storage(timestamp);
        `);
        
        console.log('✅ Structure de la base de données créée');
      }
      
      console.log('✅ Base de données auth SQLite prête');
      
    } catch (error) {
      console.error('❌ Erreur initialisation auth DB:', error);
      this.db = null;
      throw error;
    }
  }

  private async ensureDbInitialized(): Promise<void> {
    if (!this.db) {
      await this.initDatabase();
    }
  }

  // ==================== SYSTÈME DE QUEUE ====================

  /**
   * 🔒 Ajoute une opération à la queue et la traite
   */
  private async enqueueOperation(operation: Omit<QueueOperation, 'resolve' | 'reject'>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.operationQueue.push({
        ...operation,
        resolve,
        reject
      });
      
      // Démarrer le traitement si pas déjà en cours
      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * 🔄 Traite la queue d'opérations séquentiellement
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.operationQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift();
      if (!operation) continue;

      try {
        let result: any;

        switch (operation.type) {
          case 'save':
            result = await this._doSave(operation.key!, operation.value);
            break;
          case 'remove':
            result = await this._doRemove(operation.key!);
            break;
          case 'clear':
            result = await this._doClear();
            break;
        }

        operation.resolve(result);
      } catch (error) {
        operation.reject(error);
      }
    }

    this.isProcessingQueue = false;
  }

  // ==================== OPÉRATIONS CRUD AVEC QUEUE ====================

  /**
   * ✅ Sauvegarde des données (avec queue)
   */
  async save(key: string, value: any): Promise<boolean> {
    try {
      // 🔒 OPTIMISATION: Vérifier le cache au lieu de lire depuis DB
      const cachedValue = this.cache.get(key);
      
      // Comparer avec le cache
      if (cachedValue !== undefined) {
        const cachedJson = JSON.stringify(cachedValue);
        const newJson = JSON.stringify(value);
        
        if (cachedJson === newJson) {
          // Valeur identique, pas besoin de sauvegarder
          return true;
        }
      }
      
      // Mettre à jour le cache
      this.cache.set(key, value);
      
      return await this.enqueueOperation({
        type: 'save',
        key,
        value
      });
    } catch (error) {
      console.error(`❌ Erreur sauvegarde ${key}:`, error);
      return false;
    }
  }

  /**
   * 🔧 Fonction interne de sauvegarde (sans queue)
   */
  private async _doSave(key: string, value: any): Promise<boolean> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const dataToStore = {
        data: value,
        timestamp: Date.now(),
        version: this.version
      };

      await this.db.runAsync(
        'INSERT OR REPLACE INTO auth_storage (key, value, timestamp, version) VALUES (?, ?, ?, ?)',
        [key, JSON.stringify(dataToStore), Date.now(), this.version]
      );

      return true;

    } catch (error) {
      console.error(`❌ Erreur _doSave ${key}:`, error);
      throw error;
    }
  }

  /**
   * ✅ Récupération des données (avec cache)
   */
  async get(key: string): Promise<any | null> {
    try {
      // 💾 Vérifier le cache d'abord
      if (this.cache.has(key)) {
        return this.cache.get(key);
      }
      
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const result = await this.db.getFirstAsync<StorageRecord>(
        'SELECT * FROM auth_storage WHERE key = ?',
        [key]
      );

      if (!result) {
        return null;
      }

      const parsed = JSON.parse(result.value);
      
      // Mettre en cache
      this.cache.set(key, parsed.data);
      
      return parsed.data;

    } catch (error) {
      console.error(`❌ Erreur récupération ${key}:`, error);
      return null;
    }
  }

  /**
   * ✅ Suppression d'une clé (avec queue)
   */
  async remove(key: string): Promise<boolean> {
    try {
      return await this.enqueueOperation({
        type: 'remove',
        key
      });
    } catch (error) {
      console.error(`❌ Erreur suppression ${key}:`, error);
      return false;
    }
  }

  /**
   * 🔧 Fonction interne de suppression (sans queue)
   */
  private async _doRemove(key: string): Promise<boolean> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const result = await this.db.runAsync(
        'DELETE FROM auth_storage WHERE key = ?',
        [key]
      );

      // Supprimer du cache
      this.cache.delete(key);

      console.log('🗑️ Clé supprimée:', key);
      return result.changes > 0;

    } catch (error) {
      console.error(`❌ Erreur _doRemove ${key}:`, error);
      throw error;
    }
  }

  /**
   * ✅ Suppression de toutes les données (avec queue)
   */
  async clear(): Promise<boolean> {
    try {
      return await this.enqueueOperation({
        type: 'clear'
      });
    } catch (error) {
      console.error('❌ Erreur vidage auth storage:', error);
      return false;
    }
  }

  /**
   * 🔧 Fonction interne de clear (sans queue)
   */
  private async _doClear(): Promise<boolean> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      await this.db.runAsync('DELETE FROM auth_storage');
      
      // Vider le cache
      this.cache.clear();
      
      console.log('🧹 Toutes les données auth supprimées');
      return true;

    } catch (error) {
      console.error('❌ Erreur _doClear:', error);
      throw error;
    }
  }

  /**
   * ✅ Liste toutes les clés (pas de queue nécessaire)
   */
  async getAllKeys(): Promise<string[]> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const result = await this.db.getAllAsync<{ key: string }>(
        'SELECT key FROM auth_storage'
      );

      return result.map(row => row.key);

    } catch (error) {
      console.error('❌ Erreur récupération clés:', error);
      return [];
    }
  }

  /**
   * ✅ Obtenir la taille de la base de données
   */
  async getStorageSize(): Promise<{ count: number; size: string }> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const result = await this.db.getFirstAsync<{ count: number; total_size: number }>(
        'SELECT COUNT(*) as count, SUM(LENGTH(value)) as total_size FROM auth_storage'
      );

      if (!result) {
        return { count: 0, size: '0 bytes' };
      }

      const sizeInBytes = result.total_size || 0;
      let sizeStr = '';

      if (sizeInBytes < 1024) {
        sizeStr = `${sizeInBytes} bytes`;
      } else if (sizeInBytes < 1024 * 1024) {
        sizeStr = `${(sizeInBytes / 1024).toFixed(2)} KB`;
      } else {
        sizeStr = `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
      }

      return {
        count: result.count,
        size: sizeStr
      };

    } catch (error) {
      console.error('❌ Erreur calcul taille:', error);
      return { count: 0, size: '0 bytes' };
    }
  }

  /**
   * ✅ Vérifier si une clé existe
   */
  async has(key: string): Promise<boolean> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const result = await this.db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM auth_storage WHERE key = ?',
        [key]
      );

      return (result?.count || 0) > 0;

    } catch (error) {
      console.error(`❌ Erreur vérification clé ${key}:`, error);
      return false;
    }
  }

  /**
   * ✅ Obtenir toutes les données (debug)
   */
  async getAllData(): Promise<Record<string, any>> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const result = await this.db.getAllAsync<StorageRecord>(
        'SELECT * FROM auth_storage'
      );

      const data: Record<string, any> = {};
      
      for (const row of result) {
        try {
          const parsed = JSON.parse(row.value);
          data[row.key] = parsed.data;
        } catch (parseError) {
          console.error(`⚠️ Erreur parsing ${row.key}:`, parseError);
          data[row.key] = null;
        }
      }

      return data;

    } catch (error) {
      console.error('❌ Erreur récupération toutes données:', error);
      return {};
    }
  }

  /**
   * ✅ Nettoyer les anciennes données (optionnel - pour maintenance)
   */
  async cleanOldData(daysOld: number = 365): Promise<number> {
    try {
      await this.ensureDbInitialized();

      if (!this.db) {
        throw new Error('Base de données non initialisée');
      }

      const cutoffTimestamp = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

      const result = await this.db.runAsync(
        'DELETE FROM auth_storage WHERE timestamp < ?',
        [cutoffTimestamp]
      );

      if (result.changes > 0) {
        console.log(`🧹 ${result.changes} anciennes données supprimées (> ${daysOld} jours)`);
      }

      return result.changes;

    } catch (error) {
      console.error('❌ Erreur nettoyage anciennes données:', error);
      return 0;
    }
  }

  /**
   * ✅ Fermer la connexion (à utiliser seulement si vraiment nécessaire)
   */
  async closeDatabase(): Promise<void> {
    if (this.db) {
      try {
        await this.db.closeAsync();
        this.db = null;
        console.log('🔒 Base de données auth fermée');
      } catch (error) {
        console.error('❌ Erreur fermeture DB:', error);
      }
    }
  }

  // ==================== COMPATIBILITÉ AsyncStorage ====================
  
  /**
   * ✅ Alias pour compatibilité avec AsyncStorage
   */
  async setItem(key: string, value: string): Promise<void> {
    await this.save(key, value);
  }

  async getItem(key: string): Promise<string | null> {
    const result = await this.get(key);
    return result ? (typeof result === 'string' ? result : JSON.stringify(result)) : null;
  }

  async removeItem(key: string): Promise<void> {
    await this.remove(key);
  }

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.remove(key);
    }
  }
}

// Export singleton
export const authStorageService = new AuthStorageService();

// Auto-initialisation silencieuse (une seule fois au démarrage de l'app)
(async () => {
  try {
    await authStorageService.initDatabase();
  } catch (error) {
    console.error('❌ Erreur auto-initialisation authStorageService:', error);
  }
})();

export default authStorageService;
