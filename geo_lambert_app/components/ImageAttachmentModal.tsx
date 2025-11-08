// Ce fichier doit être créé dans le dossier components/
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import sendImageService from '@/services/sendImageService';

interface ImageAttachmentModalProps {
    visible: boolean;
    onClose: () => void;
    taskId?: number;
    depenseId?: number;
    onSuccess?: () => void;
}

export const ImageAttachmentModal: React.FC<ImageAttachmentModalProps> = ({
    visible,
    onClose,
    taskId,
    depenseId,
    onSuccess
}) => {
    const [isUploading, setIsUploading] = React.useState(false);

    const handleTakePhoto = async () => {
        try {
            setIsUploading(true);
            
            const result = await sendImageService.takePhotoAndUpload({
                taskId,
                depenseId,
                name: `Photo ${taskId ? 'Task' : 'Dépense'} ${new Date().toLocaleString('fr-FR')}`
            });

            if (result.success) {
                Alert.alert(
                    '✅ Photo envoyée',
                    'La photo a été envoyée avec succès',
                    [
                        {
                            text: 'OK',
                            onPress: () => {
                                onClose();
                                onSuccess?.();
                            }
                        }
                    ]
                );
            } else {
                Alert.alert('Erreur', result.error || 'Échec de l\'envoi de la photo');
            }
        } catch (error) {
            console.error('❌ Erreur photo:', error);
            Alert.alert('Erreur', 'Une erreur est survenue');
        } finally {
            setIsUploading(false);
        }
    };

    const handlePickImage = async () => {
        try {
            setIsUploading(true);
            
            const result = await sendImageService.pickImageAndUpload({
                taskId,
                depenseId,
                name: `Image ${taskId ? 'Task' : 'Dépense'} ${new Date().toLocaleString('fr-FR')}`
            });

            if (result.success) {
                Alert.alert(
                    '✅ Image envoyée',
                    'L\'image a été envoyée avec succès',
                    [
                        {
                            text: 'OK',
                            onPress: () => {
                                onClose();
                                onSuccess?.();
                            }
                        }
                    ]
                );
            } else {
                Alert.alert('Erreur', result.error || 'Échec de l\'envoi de l\'image');
            }
        } catch (error) {
            console.error('❌ Erreur image:', error);
            Alert.alert('Erreur', 'Une erreur est survenue');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Ionicons name="image" size={24} color="#3b82f6" />
                        <Text style={styles.modalTitle}>Ajouter une photo</Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            disabled={isUploading}
                        >
                            <Ionicons name="close" size={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>

                    {/*<View style={styles.optionsContainer}>*/}
                    {/*    <TouchableOpacity*/}
                    {/*        style={[styles.optionButton, isUploading && styles.optionButtonDisabled]}*/}
                    {/*        onPress={handleTakePhoto}*/}
                    {/*        disabled={isUploading}*/}
                    {/*    >*/}
                    {/*        <View style={styles.optionIcon}>*/}
                    {/*            <Ionicons name="camera" size={32} color="#3b82f6" />*/}
                    {/*        </View>*/}
                    {/*        <Text style={styles.optionText}>Prendre une photo</Text>*/}
                    {/*    </TouchableOpacity>*/}

                    {/*    <TouchableOpacity*/}
                    {/*        style={[styles.optionButton, isUploading && styles.optionButtonDisabled]}*/}
                    {/*        onPress={handlePickImage}*/}
                    {/*        disabled={isUploading}*/}
                    {/*    >*/}
                    {/*        <View style={styles.optionIcon}>*/}
                    {/*            <Ionicons name="images" size={32} color="#10b981" />*/}
                    {/*        </View>*/}
                    {/*        <Text style={styles.optionText}>Choisir depuis la galerie</Text>*/}
                    {/*    </TouchableOpacity>*/}
                    {/*</View>*/}

                    {isUploading && (
                        <View style={styles.loadingOverlay}>
                            <Text style={styles.loadingText}>Envoi en cours...</Text>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        width: '100%',
        maxWidth: 400,
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        flex: 1,
        marginLeft: 12,
    },
    closeButton: {
        padding: 4,
    },
    optionsContainer: {
        padding: 20,
        gap: 16,
    },
    optionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        padding: 20,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#e5e7eb',
    },
    optionButtonDisabled: {
        opacity: 0.5,
    },
    optionIcon: {
        width: 56,
        height: 56,
        borderRadius: 12,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    optionText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        flex: 1,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#3b82f6',
        marginTop: 12,
    },
});
