// SendImageService - Upload d'images vers Odoo send.image model
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { getStoredCredentials } from './authService';
import { getCurrentApiUrl, type RPCPayload, type PayloadCredentials } from './config/configService';

// Interface pour les données d'image
export interface ImageUploadData {
    name: string;
    task_id?: number;
    depense_id?: number; // ID de la dépense (hr.expense.account.move)
    longitude?: number;
    latitude?: number;
    address?: string;
    image: string; // Base64
    image_filename: string;
}

// Interface pour la réponse
export interface ImageUploadResponse {
    success: boolean;
    message?: string;
    result?: {
        id: number;
        name: string;
        image_filename: string;
    };
    error?: string;
}

/**
 * Payload pour créer une image dans send.image
 */
const createImagePayload = (
    credentials: PayloadCredentials,
    imageData: ImageUploadData
): RPCPayload => ({
    operation: 'rpc',
    db: credentials.db,
    username: credentials.username,
    password: credentials.password,
    model: 'send.image',
    method: 'create',
    kwargs: {
        vals: {
            name: imageData.name,
            ...(imageData.task_id && { task_id: imageData.task_id }),
            ...(imageData.depense_id && { depense_id: imageData.depense_id }),
            ...(imageData.longitude && { longitude: imageData.longitude }),
            ...(imageData.latitude && { latitude: imageData.latitude }),
            ...(imageData.address && { address: imageData.address }),
            image: imageData.image,
            image_filename: imageData.image_filename,
        }
    }
});

class SendImageService {
    /**
     * 📸 Demande les permissions pour la caméra
     */
    async requestCameraPermissions(): Promise<boolean> {
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                console.warn('⚠️ Permission caméra refusée');
                return false;
            }
            return true;
        } catch (error) {
            console.error('❌ Erreur demande permission caméra:', error);
            return false;
        }
    }

    /**
     * 📷 Demande les permissions pour la galerie
     */
    async requestMediaLibraryPermissions(): Promise<boolean> {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                console.warn('⚠️ Permission galerie refusée');
                return false;
            }
            return true;
        } catch (error) {
            console.error('❌ Erreur demande permission galerie:', error);
            return false;
        }
    }

    /**
     * 📍 Récupère la position GPS actuelle
     */
    async getCurrentLocation(): Promise<{
        latitude: number;
        longitude: number;
        address?: string;
    } | null> {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            
            if (status !== 'granted') {
                console.warn('⚠️ Permission localisation refusée');
                return null;
            }

            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });

            const { latitude, longitude } = location.coords;

            // Essayer de récupérer l'adresse (optionnel)
            let address: string | undefined;
            try {
                const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
                if (geocode && geocode.length > 0) {
                    const geo = geocode[0];
                    address = `${geo.street || ''} ${geo.city || ''} ${geo.region || ''} ${geo.country || ''}`.trim();
                }
            } catch (geocodeError) {
                console.warn('⚠️ Impossible de récupérer l\'adresse:', geocodeError);
            }

            return { latitude, longitude, address };

        } catch (error) {
            console.error('❌ Erreur récupération localisation:', error);
            return null;
        }
    }

    /**
     * 📸 Prendre une photo avec la caméra
     */
    async takePhoto(): Promise<ImagePicker.ImagePickerAsset | null> {
        try {
            const hasPermission = await this.requestCameraPermissions();
            if (!hasPermission) {
                return null;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: false,  // ✅ Pas d'édition, prendre l'image complète
                quality: 0.8,
                base64: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return null;
            }

            return result.assets[0];

        } catch (error) {
            console.error('❌ Erreur prise photo:', error);
            return null;
        }
    }

    /**
     * 🖼️ Sélectionner une image depuis la galerie
     */
    async pickImageFromGallery(): Promise<ImagePicker.ImagePickerAsset | null> {
        try {
            const hasPermission = await this.requestMediaLibraryPermissions();
            if (!hasPermission) {
                return null;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.8,
                base64: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return null;
            }

            return result.assets[0];

        } catch (error) {
            console.error('❌ Erreur sélection image:', error);
            return null;
        }
    }

    /**
     * ☁️ Upload d'une image vers Odoo send.image
     */
    async uploadImage(imageData: ImageUploadData): Promise<ImageUploadResponse> {
        try {
            console.log('☁️ Upload image vers Odoo...');
            console.log('📊 Données:', {
                name: imageData.name,
                task_id: imageData.task_id,
                depense_id: imageData.depense_id,
                has_image: !!imageData.image,
                image_size: imageData.image?.length,
                gps: imageData.latitude ? `${imageData.latitude}, ${imageData.longitude}` : 'non'
            });

            // Récupérer les credentials
            const credentials = await getStoredCredentials();
            if (!credentials) {
                return {
                    success: false,
                    error: 'Identifiants non trouvés. Veuillez vous reconnecter.'
                };
            }

            // Créer le payload
            const payload = createImagePayload(credentials, imageData);

            // Logger payload sans l'image base64 pour éviter de saturer les logs
            // @ts-ignore
            const payloadForLog = {
                ...payload,
                kwargs: {
                    ...payload.kwargs,
                    vals: {
                        ...payload.kwargs.vals,
                        image: `[BASE64_${imageData.image.length}_bytes]`
                    }
                }
            };
            console.log('📤 Payload:', JSON.stringify(payloadForLog, null, 2));
            
            // Envoyer la requête
            const apiUrl = getCurrentApiUrl();
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            console.log('📥 Status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Response body:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
            }

            const data = await response.json();
            console.log('📥 Response:', JSON.stringify(data, null, 2));

            if (data.success && data.result) {
                console.log('✅ Image uploadée avec succès:', data.result);
                return {
                    success: true,
                    message: 'Image envoyée avec succès',
                    result: {
                        id: data.result,
                        name: imageData.name,
                        image_filename: imageData.image_filename
                    }
                };
            } else {
                console.error('❌ Échec upload:', data.error || data);
                return {
                    success: false,
                    error: data.error || 'Échec de l\'upload de l\'image'
                };
            }

        } catch (error) {
            console.error('❌ Erreur upload image:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    }

    /**
     * 📸 Workflow complet: Prendre photo + Upload
     * @param taskId - ID de la tâche (si depuis page task)
     * @param depenseId - ID de la dépense (si depuis page dépense)
     */
    async takePhotoAndUpload(params: {
        taskId?: number;
        depenseId?: number;
        name?: string;
    }): Promise<ImageUploadResponse> {
        try {
            // 1. Prendre la photo
            const photo = await this.takePhoto();
            if (!photo || !photo.base64) {
                return {
                    success: false,
                    error: 'Aucune photo prise'
                };
            }

            // 2. Récupérer la localisation
            const location = await this.getCurrentLocation();

            // 3. Préparer les données
            const filename = `IMG_${Date.now()}.jpg`;
            const name = params.name || `Image ${new Date().toLocaleString('fr-FR')}`;

            const imageData: ImageUploadData = {
                name,
                image: photo.base64,
                image_filename: filename,
                ...(params.taskId && { task_id: params.taskId }),
                ...(params.depenseId && { depense_id: params.depenseId }),
                ...(location && {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    address: location.address
                })
            };

            // 4. Upload
            return await this.uploadImage(imageData);

        } catch (error) {
            console.error('❌ Erreur workflow photo:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    }

    /**
     * 🖼️ Workflow complet: Sélectionner depuis galerie + Upload
     * @param taskId - ID de la tâche (si depuis page task)
     * @param depenseId - ID de la dépense (si depuis page dépense)
     */
    async pickImageAndUpload(params: {
        taskId?: number;
        depenseId?: number;
        name?: string;
    }): Promise<ImageUploadResponse> {
        try {
            // 1. Sélectionner l'image
            const image = await this.pickImageFromGallery();
            if (!image || !image.base64) {
                return {
                    success: false,
                    error: 'Aucune image sélectionnée'
                };
            }

            // 2. Récupérer la localisation
            const location = await this.getCurrentLocation();

            // 3. Préparer les données
            const filename = `IMG_${Date.now()}.jpg`;
            const name = params.name || `Image ${new Date().toLocaleString('fr-FR')}`;

            const imageData: ImageUploadData = {
                name,
                image: image.base64,
                image_filename: filename,
                ...(params.taskId && { task_id: params.taskId }),
                ...(params.depenseId && { depense_id: params.depenseId }),
                ...(location && {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    address: location.address
                })
            };

            // 4. Upload
            return await this.uploadImage(imageData);

        } catch (error) {
            console.error('❌ Erreur workflow galerie:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    }
}

// Export singleton
export const sendImageService = new SendImageService();
export default sendImageService;
