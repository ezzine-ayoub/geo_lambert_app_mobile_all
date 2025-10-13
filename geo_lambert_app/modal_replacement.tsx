// Remplacement du modal dans task-expenses.tsx
// Remplacez la section Modal existante par ce code :

        {/* Modal pour ajouter une dépense */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={modalVisible}
          onRequestClose={handleCancelExpense}
        >
          <KeyboardAvoidingView 
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <Pressable 
              style={styles.modalPressable}
              onPress={handleCancelExpense}
            >
              <Pressable 
                style={styles.modalContainer}
                onPress={() => {}}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Nouvelle dépense</Text>
                  <TouchableOpacity 
                    onPress={handleCancelExpense}
                    style={styles.modalCloseButton}
                  >
                    <Ionicons name="close" size={24} color="#6b7280" />
                  </TouchableOpacity>
                </View>

                <ScrollView 
                  style={styles.modalScrollView}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Type de dépense */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Type de dépense</Text>
                    <TouchableOpacity 
                      style={styles.selectButton}
                      onPress={() => setShowTypeDropdown(!showTypeDropdown)}
                    >
                      <View style={styles.selectContent}>
                        <Ionicons 
                          name={getSelectedExpenseType().icon} 
                          size={20} 
                          color={getSelectedExpenseType().color} 
                        />
                        <Text style={styles.selectText}>
                          {getSelectedExpenseType().label}
                        </Text>
                      </View>
                      <Ionicons 
                        name={showTypeDropdown ? "chevron-up" : "chevron-down"} 
                        size={20} 
                        color="#6b7280" 
                      />
                    </TouchableOpacity>
                    
                    {showTypeDropdown && (
                      <View style={styles.dropdown}>
                        {expenseTypes.map((type) => (
                          <TouchableOpacity
                            key={type.value}
                            style={[
                              styles.dropdownItem,
                              newExpenseType === type.value && styles.dropdownItemSelected
                            ]}
                            onPress={() => {
                              setNewExpenseType(type.value);
                              setShowTypeDropdown(false);
                            }}
                          >
                            <Ionicons name={type.icon} size={20} color={type.color} />
                            <Text style={[
                              styles.dropdownItemText,
                              newExpenseType === type.value && styles.dropdownItemTextSelected
                            ]}>
                              {type.label}
                            </Text>
                            {newExpenseType === type.value && (
                              <Ionicons name="checkmark" size={20} color="#3b82f6" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Description */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Description</Text>
                    <TextInput
                      style={styles.descriptionInput}
                      value={newExpenseDescription}
                      onChangeText={setNewExpenseDescription}
                      placeholder="Ex: Achat de matériel, frais de transport..."
                      multiline={true}
                      numberOfLines={3}
                      textAlignVertical="top"
                      returnKeyType="done"
                      blurOnSubmit={true}
                    />
                  </View>

                  {/* Montant */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Montant (USD)</Text>
                    <View style={styles.amountInputContainer}>
                      <TextInput
                        style={styles.amountInput}
                        value={newExpenseAmount}
                        onChangeText={setNewExpenseAmount}
                        placeholder="0.00"
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        blurOnSubmit={true}
                      />
                      <Text style={styles.currencyLabel}>USD</Text>
                    </View>
                  </View>
                </ScrollView>

                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={styles.cancelButton}
                    onPress={handleCancelExpense}
                  >
                    <Text style={styles.cancelButtonText}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.saveButton}
                    onPress={handleSaveExpense}
                  >
                    <Text style={styles.saveButtonText}>Ajouter</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
