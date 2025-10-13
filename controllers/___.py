# -*- coding: utf-8 -*-
import json
import logging
from datetime import datetime

from odoo.service import db
from odoo import http, registry, SUPERUSER_ID
from odoo.http import request, Response
from odoo.exceptions import ValidationError, AccessError, UserError

_logger = logging.getLogger(__name__)


class OdooRPCController(http.Controller):
    """
    Unified Odoo RPC API - Essential routes only + Users
    """

    def _authenticate(self, db, username, password):
        """Correct authentication for Odoo 18"""
        try:
            if not all([db, username, password]):
                return {"success": False, "error": "Missing credentials"}

            # FIXED: Use the correct Odoo 18 authentication method
            try:
                # Use session authenticate method which is the proper way in Odoo 18
                uid = request.session.authenticate(db, username, password)

                if not uid:
                    return {"success": False, "error": "Invalid credentials"}

                _logger.info(f"✅ Authentication successful for UID: {uid}")

            except Exception as auth_error:
                _logger.error(f"Authentication error: {str(auth_error)}")
                return {"success": False, "error": "Authentication failed"}

            _logger.info(f"✅ Authentication successful for UID: {uid}")

            # Get user information
            try:
                # Use request.env with the authenticated user
                user = request.env['res.users'].sudo().browse(uid)
                if not user.exists():
                    return {"success": False, "error": "User not found"}

                _logger.info(f"📊 Fetching complete user info for: {user.name}")

                # Get partner information
                partner = user.partner_id

                # Get group names
                group_names = [group.name for group in user.groups_id] if user.groups_id else []

                # Check if user is admin
                is_admin = user.has_group('base.group_system')

                # Get company info
                company = user.company_id

                # Build complete user info
                user_info = {
                    "success": True,
                    "id": user.id,
                    # Basic user info
                    "uid": uid,
                    "user_name": user.name,
                    "user_login": user.login,
                    "active": user.active,

                    # Contact info - prioritize partner then user
                    "email": partner.email or user.email or None,
                    "phone": partner.phone or user.phone or None,
                    "mobile": partner.mobile or user.mobile or None,
                    "website": partner.website if partner else None,

                    # Partner info
                    "partner_id": partner.id if partner else None,
                    "partner_name": partner.name if partner else None,

                    # Address info
                    "street": partner.street if partner else None,
                    "street2": partner.street2 if partner else None,
                    "city": partner.city if partner else None,
                    "state_id": partner.state_id.name if partner and partner.state_id else None,
                    "country_id": partner.country_id.name if partner and partner.country_id else None,
                    "zip": partner.zip if partner else None,

                    # Professional info
                    "company_id": company.id if company else None,
                    "company_name": company.name if company else None,
                    "is_company": partner.is_company if partner else False,
                    "function": partner.function if partner else None,
                    "title": partner.title.name if partner and partner.title else None,

                    # User preferences
                    "lang": user.lang or None,
                    "tz": user.tz or None,
                    "category_id": [cat.name for cat in partner.category_id] if partner and partner.category_id else [],

                    # Security and permissions
                    "is_admin": is_admin,
                    "groups": group_names,

                    # Image
                    "image_url": f"/web/image/res.users/{uid}/image_128" if user.image_128 else None,

                    # Important dates
                    "create_date": user.create_date.isoformat() if user.create_date else None,
                    "login_date": user.login_date.isoformat() if user.login_date else None,

                    # Additional info
                    "signature": user.signature if user.signature else None,
                    "notification_type": user.notification_type if hasattr(user, 'notification_type') else None,

                    # Backward compatibility
                    "username": user.login,
                    "display_name": user.name
                }
                return user_info

            except Exception as e:
                _logger.error(f"❌ Error fetching complete user info: {str(e)}")
                # Fallback to minimal info
                return {
                    "success": True,
                    "uid": uid,
                    "user_name": "User",
                    "user_login": username,
                    "error_details": f"Could not fetch complete info: {str(e)}"
                }

        except Exception as e:
            _logger.error(f"❌ Authentication error: {str(e)}")
            return {"success": False, "error": "Authentication failed"}

    def _debug_domain_filtering_step_by_step(self, model_obj, objects_list, domain_filter, model_name):
        """DEBUG: Step-by-step domain filtering analysis for troubleshooting

        Cette méthode analyse pourquoi le domain filtering ne fonctionne pas
        """
        debug_info = {
            'model_name': model_name,
            'input_objects_count': len(objects_list),
            'domain_filter': domain_filter,
            'steps': [],
            'final_result': None,
            'error': None
        }

        try:
            _logger.info(f"🔬 DEBUG DOMAIN FILTERING STEP-BY-STEP for {model_name}")
            _logger.info(f"📦 Input objects: {len(objects_list)}")
            _logger.info(f"🔍 Domain filter: {domain_filter}")

            # Step 1: Extract IDs from objects
            provided_ids = []
            for obj in objects_list:
                if isinstance(obj, dict) and 'id' in obj:
                    provided_ids.append(obj['id'])

            if not provided_ids:
                debug_info['error'] = "No valid IDs found in objects"
                return debug_info

            # Step 2: Test if IDs exist in database
            try:
                existing_records = model_obj.browse(provided_ids).exists()
                existing_ids = existing_records.ids
                missing_ids = [id for id in provided_ids if id not in existing_ids]

                if not existing_ids:
                    debug_info['error'] = f"None of the provided IDs exist in {model_name}: {provided_ids}"
                    return debug_info

            except Exception as e:
                _logger.error(f"❌ STEP 2 FAILED: {str(e)}")
                return debug_info

            # Step 3: Test domain alone (without ID filter)
            if domain_filter:
                try:
                    domain_records = model_obj.search(domain_filter)
                    domain_matching_ids = domain_records.ids

                except Exception as e:

                    _logger.error(f"❌ STEP 3 FAILED: {str(e)}")
                    debug_info['error'] = f"Domain filter failed: {str(e)}"
                    return debug_info
            else:
                domain_matching_ids = []  # No domain filter


            # Step 4: Find intersection
            if domain_filter:
                intersection_ids = list(set(existing_ids) & set(domain_matching_ids))
                excluded_by_domain = list(set(existing_ids) - set(domain_matching_ids))
                final_matching_ids = intersection_ids
            else:
                final_matching_ids = existing_ids

            # Step 5: Filter objects
            objects_by_id = {obj['id']: obj for obj in objects_list if isinstance(obj, dict) and 'id' in obj}
            filtered_objects = [
                objects_by_id[obj_id] for obj_id in final_matching_ids
                if obj_id in objects_by_id
            ]

            return debug_info

        except Exception as e:
            debug_info['error'] = str(e)
            _logger.error(f"❌ DEBUG ANALYSIS FAILED: {str(e)}")
            return debug_info

    def _apply_domain_filter_to_objects(self, model_obj, objects_list, domain_filter, model_name):
        try:

            # Quick validation
            if not objects_list:
                _logger.info(f"📭 Empty objects list - returning empty for caller to handle")
                return []

            if not domain_filter:
                _logger.info(f"🔍 No domain filter - returning all {len(objects_list)} objects")
                return objects_list

            # Use step-by-step debug analysis
            _logger.info(f"🔬 Running step-by-step domain analysis...")
            debug_result = self._debug_domain_filtering_step_by_step(model_obj, objects_list, domain_filter, model_name)

            if debug_result.get('error'):

                return []  # Return empty on error

            if debug_result.get('final_result') and debug_result['final_result'].get('success'):
                filtered_objects = debug_result['final_result']['filtered_objects']

                # Additional validation
                filtered_count = len(filtered_objects)
                original_count = len(objects_list)

                if filtered_count == 0:
                    _logger.warning(f"⚠️ ZERO objects match domain conditions!")
                    _logger.warning(f"   🔍 Domain: {domain_filter}")
                    _logger.warning(f"   📋 Objects IDs: {[obj.get('id') for obj in objects_list]}")
                elif filtered_count < original_count:
                    excluded_count = original_count - filtered_count
                    _logger.info(f"✂️ Filtered out {excluded_count} objects that don't match domain")
                else:
                    _logger.info(f"✅ ALL objects match domain conditions")

                return filtered_objects
            else:
                _logger.error(f"❌ Debug analysis did not produce valid results")
                return []

        except Exception as e:
            _logger.error(f"❌ CRITICAL ERROR in enhanced domain filtering: {str(e)}")
            _logger.error(f"🔧 Falling back to original objects list")
            return objects_list  # Fallback to original

    def _clean_kwargs_for_odoo(self, kwargs):
        """Remove custom parameters that shouldn't be passed to Odoo methods and normalize order parameter"""
        if not isinstance(kwargs, dict):
            return kwargs

        # Parameters to remove before calling Odoo methods
        # Note: 'domain' is kept as it's a valid Odoo parameter for search operations
        custom_params = ['replaceToObject',
                         'only_significant_modifications',
                         'significant_threshold_hours',
                         'include_missing']

        cleaned_kwargs = {k: v for k, v in kwargs.items() if k not in custom_params}

        # Normalize order parameter: convert 'dec' to 'desc'
        if 'order' in cleaned_kwargs and isinstance(cleaned_kwargs['order'], str):
            original_order = cleaned_kwargs['order']
            # Replace 'dec' with 'desc' (case insensitive, word boundary aware)
            import re
            normalized_order = re.sub(r'\b(dec)\b', 'desc', original_order, flags=re.IGNORECASE)
            if normalized_order != original_order:
                _logger.info(f"🔄 Normalized order parameter: '{original_order}' -> '{normalized_order}'")
                cleaned_kwargs['order'] = normalized_order

        if len(cleaned_kwargs) != len(kwargs):
            _logger.info(f"🧼 Filtered out custom parameters: {list(set(kwargs.keys()) - set(cleaned_kwargs.keys()))}")

        return cleaned_kwargs

    def _get_available_fields(self, model_obj, desired_fields):
        """Get only available fields from desired_fields list"""
        try:
            # Get model fields
            model_fields = model_obj.fields_get().keys()

            # Filter only existing fields
            available_fields = [field for field in desired_fields if field in model_fields]

            _logger.info(f"Available fields for {model_obj._name}: {len(available_fields)}/{len(desired_fields)}")

            return available_fields

        except Exception as e:
            _logger.error(f"Error getting available fields: {str(e)}")
            # Fallback to basic fields
            return ['id', 'name', 'display_name']

    def _populate_relational_fields(self, records, env, replace_config):
        """Generic method to replace IDs with full objects based on replaceToObject configuration"""
        try:
            if not isinstance(records, list) or not records or not replace_config:
                return records

            _logger.info(f"🔄 Starting relational fields population with config: {replace_config}")

            for record in records:
                if not isinstance(record, dict):
                    continue

                # Process each replacement configuration
                for replace_item in replace_config:
                    if not isinstance(replace_item, dict):
                        continue

                    for field_path, target_config in replace_item.items():
                        self._process_field_replacement(record, field_path, target_config, env)

            return records

        except Exception as e:
            _logger.error(f"Error in _populate_relational_fields: {str(e)}")
            return records

    def _process_field_replacement(self, record, field_path, target_config, env, current_path=""):
        """Process a single field replacement, handling nested paths and custom field selection"""
        try:
            _logger.info(f"🔍 Processing field replacement: '{field_path}' at path '{current_path}'")
            _logger.info(f"📋 Current record keys: {list(record.keys()) if isinstance(record, dict) else 'Not a dict'}")

            # Handle nested field paths (e.g., "product_variant_ids.product_template_variant_value_ids")
            if '.' in field_path:
                parts = field_path.split('.', 1)
                current_field = parts[0]
                remaining_path = parts[1]

                _logger.info(f"🔗 Nested path detected: '{current_field}' -> '{remaining_path}'")

                if current_field in record and record[current_field]:
                    field_value = record[current_field]
                    _logger.info(f"✅ Found field '{current_field}' with value type: {type(field_value)}")

                    # If it's a list of objects, process each one
                    if isinstance(field_value, list):
                        _logger.info(f"📝 Processing list with {len(field_value)} items")
                        for i, item in enumerate(field_value):
                            if isinstance(item, dict):
                                _logger.info(
                                    f"🎯 Processing list item {i + 1}/{len(field_value)} with keys: {list(item.keys())}")
                                self._process_field_replacement(item, remaining_path, target_config, env,
                                                                f"{current_path}.{current_field}" if current_path else current_field)
                            else:
                                _logger.warning(f"⚠️ List item {i + 1} is not a dict: {type(item)}")
                    # If it's a single object
                    elif isinstance(field_value, dict):
                        _logger.info(f"📝 Processing single dict with keys: {list(field_value.keys())}")
                        self._process_field_replacement(field_value, remaining_path, target_config, env,
                                                        f"{current_path}.{current_field}" if current_path else current_field)
                    else:
                        _logger.warning(
                            f"⚠️ Field '{current_field}' value is neither list nor dict: {type(field_value)}")
                else:
                    _logger.warning(f"❌ Field '{current_field}' not found or empty in record")
                    if current_field not in record:
                        _logger.info(
                            f"🔍 Available fields in record: {list(record.keys()) if isinstance(record, dict) else 'Not a dict'}")
            else:
                # Direct field replacement
                if field_path in record and record[field_path]:
                    field_value = record[field_path]
                    full_path = f"{current_path}.{field_path}" if current_path else field_path

                    _logger.info(f"🔄 Direct field replacement for '{full_path}'")
                    _logger.info(f"📦 Field value type: {type(field_value)}, value: {field_value}")

                    # Parse target configuration (support both old and new formats)
                    target_model, desired_fields = self._parse_target_config(target_config, full_path)

                    if not target_model:
                        _logger.error(f"❌ No target model found for '{full_path}'")
                        return

                    _logger.info(
                        f"🔄 Processing field '{full_path}' -> model '{target_model}' with fields: {desired_fields if desired_fields else 'default'}")

                    # Convert field value to list of IDs
                    ids_to_fetch = self._extract_ids_from_field(field_value)

                    if ids_to_fetch:
                        _logger.info(f"🆔 Extracted IDs to fetch: {ids_to_fetch}")
                        try:
                            # Fetch full objects from target model with specific fields
                            target_objects = self._fetch_full_objects_with_fields(env, target_model, ids_to_fetch,
                                                                                  desired_fields)

                            if target_objects:
                                # Replace IDs with full objects
                                if isinstance(field_value, (int, str)):
                                    record[field_path] = target_objects[0] if target_objects else field_value
                                    _logger.info(f"✅ Replaced single ID with object for '{full_path}'")
                                else:
                                    record[field_path] = target_objects
                                    _logger.info(f"✅ Replaced {len(target_objects)} objects for '{full_path}'")

                                _logger.info(
                                    f"✅ Successfully replaced '{full_path}' with {len(target_objects)} objects from '{target_model}'")
                            else:
                                _logger.warning(f"⚠️ No target objects fetched for '{full_path}'")

                        except Exception as fetch_error:
                            _logger.error(f"❌ Error fetching objects for field '{full_path}': {str(fetch_error)}")
                            # Keep original value on error
                    else:
                        _logger.warning(f"⚠️ No valid IDs extracted from field '{full_path}' with value: {field_value}")

                else:
                    _logger.warning(f"❌ Field '{field_path}' not found or empty for direct replacement")
                    if isinstance(record, dict):
                        _logger.info(f"🔍 Available fields: {list(record.keys())}")

        except Exception as e:
            _logger.error(f"❌ Error in _process_field_replacement for '{field_path}': {str(e)}")
            _logger.error(f"📍 Exception occurred at path: '{current_path}'")

    def _parse_target_config(self, target_config, field_path):
        """Parse target configuration to extract model name and desired fields"""
        try:
            # New format: {"model.name": ["field1", "field2"]} or {"model.name": []}
            if isinstance(target_config, dict):
                if len(target_config) == 1:
                    model_name = list(target_config.keys())[0]
                    desired_fields = list(target_config.values())[0]

                    # Ensure desired_fields is a list or None
                    if isinstance(desired_fields, list):
                        # Empty list means use default fields
                        return model_name, desired_fields if desired_fields else None
                    else:
                        _logger.warning(f"Invalid field list format for '{field_path}': {desired_fields}")
                        return model_name, None
                else:
                    _logger.error(f"Invalid target config format for '{field_path}': multiple models not supported")
                    return None, None

            # Old format: "model.name" (backward compatibility)
            elif isinstance(target_config, str):
                return target_config, None

            else:
                _logger.error(f"Unknown target config format for '{field_path}': {type(target_config)}")
                return None, None

        except Exception as e:
            _logger.error(f"Error parsing target config for '{field_path}': {str(e)}")
            return None, None

    def _fetch_full_objects_with_fields(self, env, model_name, ids, desired_fields=None):
        """Fetch full objects from specified model with custom field selection"""
        try:
            if not ids or not model_name:
                return []

            # Get model object
            try:
                model_obj = env[model_name]
            except KeyError:
                _logger.error(f"Model '{model_name}' not found")
                return []

            # Browse and check existence
            records = model_obj.browse(ids)
            existing_records = records.exists()

            if not existing_records:
                _logger.warning(f"No existing records found in '{model_name}' for IDs: {ids}")
                return []

            # Determine which fields to fetch
            if desired_fields is not None:
                if len(desired_fields) == 0:
                    # Empty array means use default fields
                    _logger.info(f"📜 Using default fields for '{model_name}' (empty array specified)")
                    all_desired_fields = self._get_default_fields_for_model(model_name)
                else:
                    # Use specified fields + always include basic ones
                    basic_fields = ['id', 'name', 'display_name']
                    all_desired_fields = list(set(basic_fields + desired_fields))
                    _logger.info(f"🎯 Using custom fields for '{model_name}': {desired_fields}")
            else:
                # None means use default fields (backward compatibility)
                _logger.info(f"📜 Using default fields for '{model_name}' (backward compatibility)")
                all_desired_fields = self._get_default_fields_for_model(model_name)

            # Get only available fields
            available_fields = self._get_available_fields(model_obj, all_desired_fields)

            # Read data
            object_data = existing_records.read(available_fields)

            _logger.info(
                f"📦 Fetched {len(object_data)} objects from '{model_name}' with {len(available_fields)} fields")
            _logger.info(f"📝 Final fields used: {available_fields}")

            return object_data

        except Exception as e:
            _logger.error(f"Error fetching objects from '{model_name}' with custom fields: {str(e)}")
            return []

    def _extract_ids_from_field(self, field_value):
        """Extract IDs from various field value formats"""
        try:
            if isinstance(field_value, int):
                return [field_value]
            elif isinstance(field_value, (list, tuple)):
                # Handle different formats: [1, 2, 3] or [(4, id)] or [(6, 0, [1,2,3])]
                ids = []
                for item in field_value:
                    if isinstance(item, int):
                        ids.append(item)
                    elif isinstance(item, (list, tuple)) and len(item) >= 2:
                        # Handle Odoo's many2many format like (6, 0, [1,2,3]) or (4, id)
                        if len(item) == 3 and isinstance(item[2], (list, tuple)):
                            ids.extend([x for x in item[2] if isinstance(x, int)])
                        elif len(item) == 2 and isinstance(item[1], int):
                            ids.append(item[1])
                return ids
            elif isinstance(field_value, str) and field_value.isdigit():
                return [int(field_value)]
            else:
                return []
        except Exception as e:
            _logger.error(f"Error extracting IDs from field value: {str(e)}")
            return []

    def _get_default_fields_for_model(self, model_name):
        """Get default fields to fetch for different model types"""
        # Common fields for all models
        common_fields = [
            'id', 'name', 'display_name', 'create_date', 'write_date', 'active'
        ]

        # Model-specific field mappings
        model_fields = {
            'product.product': [
                'default_code', 'list_price', 'standard_price', 'cost_price',
                'product_tmpl_id', 'categ_id', 'description', 'description_sale',
                'weight', 'volume', 'barcode', 'image_1920', 'image_512',
                'qty_available', 'virtual_available', 'product_template_variant_value_ids',
                'sale_ok', 'purchase_ok', 'uom_id', 'uom_po_id', 'type',
                'attribute_value_ids', 'product_template_attribute_value_ids'
            ],
            'product.template': [
                'default_code', 'list_price', 'standard_price', 'categ_id',
                'description', 'description_sale', 'weight', 'volume',
                'image_1920', 'product_variant_ids', 'sale_ok', 'purchase_ok',
                'uom_id', 'uom_po_id', 'type', 'attribute_line_ids'
            ],
            'product.category': [
                'parent_id', 'child_id', 'complete_name', 'parent_path'
            ],
            'product.template.attribute.value': [
                'product_tmpl_id', 'attribute_id', 'value_ids', 'attribute_line_id',
                'name', 'display_name'
            ],
            'product.attribute': [
                'name', 'display_name', 'sequence', 'type', 'create_variant'
            ],
            'product.attribute.value': [
                'name', 'display_name', 'sequence', 'attribute_id', 'color',
                'is_custom', 'html_color'
            ],
            'res.partner': [
                'email', 'phone', 'mobile', 'website', 'street', 'street2',
                'city', 'state_id', 'country_id', 'zip', 'is_company',
                'parent_id', 'child_ids', 'category_id', 'supplier_rank', 'customer_rank'
            ],
            'res.users': [
                'login', 'email', 'partner_id', 'company_id', 'groups_id',
                'lang', 'tz', 'image_1920'
            ],
            'res.company': [
                'email', 'phone', 'website', 'street', 'street2',
                'city', 'state_id', 'country_id', 'zip', 'currency_id',
                'logo', 'partner_id'
            ],
            'stock.location': [
                'location_id', 'child_ids', 'complete_name', 'usage',
                'company_id', 'barcode'
            ],
            'uom.uom': [
                'category_id', 'factor', 'factor_inv', 'uom_type', 'rounding'
            ]
        }

        # Combine common fields with model-specific fields
        specific_fields = model_fields.get(model_name, [])
        return common_fields + specific_fields

    def _execute_odoo_method(self, method_func, method_name, args, kwargs):
        """Smart execution for common Odoo methods to avoid parameter conflicts"""
        try:
            _logger.info(f"Executing method: {method_name} with args: {args}, kwargs: {kwargs}")

            # Handle common Odoo methods with specific parameter patterns
            if method_name == 'read':
                # read(ids, fields=None) - should be called on model with IDs
                _logger.info(f"READ method called with args: {args}, kwargs: {kwargs}")

                if args and len(args) >= 1:
                    # First arg should be IDs, second arg (or kwargs) should be fields
                    ids = args[0]
                    fields = args[1] if len(args) > 1 else kwargs.get('fields', None)

                    _logger.info(f"Processing read with IDs: {ids}, fields: {fields}")

                    # Ensure IDs is a list
                    if not isinstance(ids, list):
                        if isinstance(ids, (int, str)):
                            ids = [ids]
                        else:
                            try:
                                ids = list(ids)
                            except:
                                _logger.error(f"Invalid IDs format for read: {ids}")
                                raise ValueError(f"Invalid IDs format: {ids}")

                    _logger.info(f"Final IDs to browse: {ids}")

                    # Browse records and read
                    try:
                        recordset = method_func.__self__.browse(ids)
                        _logger.info(f"Browsed recordset: {recordset}, exists: {recordset.exists()}")

                        # Check if records exist
                        existing_records = recordset.exists()
                        if not existing_records:
                            _logger.warning(f"No existing records found for IDs: {ids}")
                            return []

                        _logger.info(f"Found {len(existing_records)} existing records")

                        if fields:
                            result = existing_records.read(fields)
                        else:
                            result = existing_records.read()

                        _logger.info(f"Read result: {result}")
                        return result

                    except Exception as e:
                        _logger.error(f"Error during browse/read: {str(e)}")
                        raise e

                elif kwargs and 'ids' in kwargs:
                    # IDs in kwargs
                    ids = kwargs['ids']
                    fields = kwargs.get('fields', None)

                    _logger.info(f"Processing read from kwargs - IDs: {ids}, fields: {fields}")

                    if not isinstance(ids, list):
                        if isinstance(ids, (int, str)):
                            ids = [ids]
                        else:
                            try:
                                ids = list(ids)
                            except:
                                _logger.error(f"Invalid IDs format for read: {ids}")
                                raise ValueError(f"Invalid IDs format: {ids}")

                    try:
                        recordset = method_func.__self__.browse(ids)
                        existing_records = recordset.exists()
                        if not existing_records:
                            _logger.warning(f"No existing records found for IDs: {ids}")
                            return []

                        if fields:
                            return existing_records.read(fields)
                        else:
                            return existing_records.read()
                    except Exception as e:
                        _logger.error(f"Error in kwargs read: {str(e)}")
                        raise e

                else:
                    # No IDs provided, return empty
                    _logger.warning("No IDs provided for read method")
                    return []

            elif method_name == 'search_read':
                # search_read(domain=None, fields=None, offset=0, limit=None, order=None)
                if args and kwargs:
                    # Combine args and kwargs intelligently
                    final_kwargs = kwargs.copy()
                    if len(args) > 0 and 'domain' not in final_kwargs:
                        final_kwargs['domain'] = args[0]
                    if len(args) > 1 and 'fields' not in final_kwargs:
                        final_kwargs['fields'] = args[1]
                    return method_func(**final_kwargs)
                elif args:
                    # Map args to parameters
                    if len(args) == 1:
                        return method_func(domain=args[0])
                    elif len(args) == 2:
                        return method_func(domain=args[0], fields=args[1])
                    else:
                        return method_func(*args)
                elif kwargs:
                    return method_func(**kwargs)
                else:
                    return method_func()

            elif method_name == 'search':
                # search(domain, offset=0, limit=None, order=None, count=False)
                if args and kwargs:
                    result = method_func(*args, **kwargs)
                elif args:
                    result = method_func(*args)
                elif kwargs:
                    result = method_func(**kwargs)
                else:
                    result = method_func([])

                # Convert recordset to list of IDs
                if hasattr(result, 'ids'):
                    return result.ids
                elif hasattr(result, 'id'):
                    return [result.id]
                else:
                    return result

            elif method_name == 'write':
                # write(vals) - should be called on a recordset
                _logger.info(f"WRITE method - args: {args}, kwargs: {kwargs}")

                # Case 1: Domain + vals in kwargs (most common for bulk operations)
                if 'domain' in kwargs and 'vals' in kwargs:
                    domain = kwargs['domain']
                    vals = kwargs['vals'].copy()

                    # Remove 'id' from vals if present to avoid conflicts
                    if 'id' in vals:
                        del vals['id']
                        _logger.info(f"Removed 'id' field from vals for write operation")

                    _logger.info(f"Multi-edit write with domain: {domain} and vals: {vals}")

                    # Search for records matching the domain
                    try:
                        records = method_func.__self__.search(domain)
                        _logger.info(f"Found {len(records)} records matching domain: {records.ids}")

                        if not records:
                            _logger.warning(f"No records found for domain: {domain}")
                            return {
                                'success': False,
                                'error': 'No records found matching the domain',
                                'domain': domain,
                                'updated_count': 0
                            }

                        # Write to found records
                        result = records.write(vals)
                        _logger.info(f"Multi-edit write result: {result} for {len(records)} records")

                        return {
                            'success': True,
                            'updated_ids': records.ids,
                            'updated_count': len(records),
                            'write_result': result,
                            'domain': domain
                        }

                    except Exception as search_error:
                        _logger.error(f"Error during search for write operation: {str(search_error)}")
                        return {
                            'success': False,
                            'error': f'Search failed: {str(search_error)}',
                            'domain': domain,
                            'updated_count': 0
                        }

                # Case 2: IDs in args + vals in kwargs
                elif args and len(args) > 0 and 'vals' in kwargs:
                    try:
                        ids = args[0]
                        vals = kwargs['vals'].copy()

                        # Remove 'id' from vals if present
                        if 'id' in vals:
                            del vals['id']
                            _logger.info(f"Removed 'id' field from vals for write operation")

                        _logger.info(f"Writing to IDs: {ids} with vals: {vals}")

                        # Ensure IDs is a list
                        if not isinstance(ids, list):
                            if isinstance(ids, (int, str)):
                                ids = [ids]
                            else:
                                ids = list(ids)

                        # Browse the records first, then call write
                        recordset = method_func.__self__.browse(ids)
                        _logger.info(f"Browsed recordset: {recordset}")

                        result = recordset.write(vals)
                        _logger.info(f"Write result: {result}")

                        return {
                            'success': True,
                            'updated_ids': ids,
                            'updated_count': len(ids),
                            'write_result': result
                        }

                    except Exception as write_error:
                        _logger.error(f"Error in ID-based write: {str(write_error)}")
                        raise write_error

                # Case 3: vals only in kwargs (write to empty recordset - will fail)
                elif 'vals' in kwargs and (not args or len(args) == 0):
                    vals = kwargs['vals']
                    _logger.warning(f"Write called with vals only, no records specified: {vals}")
                    return {
                        'success': False,
                        'error': 'Write operation requires either domain or record IDs',
                        'suggestion': 'Use domain in kwargs or provide record IDs in args'
                    }

                # Case 4: vals directly in args[0] (direct write)
                elif args and len(args) > 0 and not kwargs:
                    try:
                        vals = args[0]
                        _logger.info(f"Direct write with vals: {vals}")
                        result = method_func(vals)
                        return result
                    except Exception as direct_write_error:
                        _logger.error(f"Error in direct write: {str(direct_write_error)}")
                        raise direct_write_error

                # Case 5: Invalid parameters
                else:
                    error_msg = f"Invalid write parameters - args: {args}, kwargs: {kwargs}"
                    _logger.error(error_msg)
                    return {
                        'success': False,
                        'error': 'Invalid write parameters',
                        'details': 'write() requires either (domain, vals) in kwargs or (ids, vals)',
                        'received_args': len(args) if args else 0,
                        'received_kwargs': list(kwargs.keys()) if kwargs else []
                    }

            elif method_name == 'create':
                # create(vals_list) - should be called on a model with vals as first argument
                _logger.info(f"CREATE method - args: {args}, kwargs: {kwargs}")

                # Check if with_fields is requested
                with_fields = kwargs.get('with_fields', False)
                fields_to_read = kwargs.get('fields', None)

                # Remove with_fields and fields from kwargs before passing to Odoo method
                clean_kwargs = {k: v for k, v in kwargs.items() if k not in ['with_fields', 'fields']}

                if args and len(args) > 0:
                    # Use the first argument as vals
                    vals = args[0]
                    _logger.info(f"Creating with vals from args: {vals}")
                    result = method_func(vals)
                elif 'vals' in clean_kwargs:
                    vals = clean_kwargs['vals']
                    _logger.info(f"Creating with vals from kwargs: {vals}")
                    result = method_func(vals)
                else:
                    raise ValueError("create() missing required 'vals' parameter")

                # If with_fields is True and we have a created record, return full object instead of just ID
                if with_fields and hasattr(result, 'read') and hasattr(result, 'id'):
                    _logger.info(f"🔄 with_fields=true detected for create, reading full object for ID: {result.id}")
                    if fields_to_read:
                        _logger.info(f"🎯 Using specific fields: {fields_to_read}")
                    else:
                        _logger.info(f"📜 Using all available fields")

                    try:
                        if fields_to_read:
                            full_object = result.read(fields_to_read)
                        else:
                            full_object = result.read()

                        if isinstance(full_object, list) and len(full_object) > 0:
                            _logger.info(f"✅ Returning full object instead of ID: {full_object[0]}")
                            return full_object[0]  # Return the first (and only) record as dict
                        else:
                            _logger.warning(f"⚠️ Could not read full object, returning ID")
                            return result
                    except Exception as read_error:
                        _logger.error(f"❌ Error reading full object: {str(read_error)}")
                        return result
                else:
                    return result

            elif method_name == 'unlink':
                # unlink()
                return method_func()

            else:
                # For custom methods, use standard execution
                if args and kwargs:
                    return method_func(*args, **kwargs)
                elif args:
                    return method_func(*args)
                elif kwargs:
                    return method_func(**kwargs)
                else:
                    return method_func()

        except Exception as e:
            _logger.error(f"Error in _execute_odoo_method: {str(e)}")
            raise

    def _handle_auth(self, data):
        """Handle authentication"""
        try:
            db = data.get('db')
            username = data.get('username')
            password = data.get('password')

            if not all([db, username, password]):
                return self._safe_json_response({
                    'success': False,
                    'error': 'Missing credentials',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            auth_result = self._authenticate(db, username, password)
            if not auth_result.get('success'):
                return self._safe_json_response({
                    'success': False,
                    'error': auth_result.get('error'),
                    'timestamp': datetime.now().isoformat()
                }, 401)

            # Remove 'success' from auth_result to avoid duplication
            user_info = {k: v for k, v in auth_result.items() if k != 'success'}

            return self._safe_json_response({
                'success': True,
                'message': 'Authentication successful',
                'user_info': user_info,
                'timestamp': datetime.now().isoformat()
            })

        except Exception as e:
            _logger.error(f"Auth error: {str(e)}")
            return self._safe_json_response({
                'success': False,
                'error': 'Authentication error',
                'timestamp': datetime.now().isoformat()
            }, 500)

    def _handle_rpc(self, data):
        """Handle RPC operations"""
        try:
            # Extract parameters
            db = data.get('db')
            username = data.get('username')
            password = data.get('password')
            model = data.get('model')
            method = data.get('method')
            args = data.get('args', [])
            kwargs = data.get('kwargs', {})

            _logger.info(f"RPC Call: {model}.{method} with args={args}, kwargs={kwargs}")

            # Validate
            if not all([db, username, password, model, method]):
                return self._safe_json_response({
                    'success': False,
                    'error': 'Missing required fields',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            if not isinstance(args, list) or not isinstance(kwargs, dict):
                return self._safe_json_response({
                    'success': False,
                    'error': 'Invalid args or kwargs format',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            # FIXED: Authenticate for RPC using session.authenticate
            try:
                uid = request.session.authenticate(db, username, password)
                
                if not uid:
                    return self._safe_json_response({
                        'success': False,
                        'error': 'Invalid credentials',
                        'timestamp': datetime.now().isoformat()
                    }, 401)

                _logger.info(f"✅ RPC Authentication successful for UID: {uid}")

            except Exception as auth_error:
                _logger.error(f"RPC Authentication error: {str(auth_error)}")
                return self._safe_json_response({
                    'success': False,
                    'error': 'Authentication failed',
                    'timestamp': datetime.now().isoformat()
                }, 401)

            try:
                # Execute method
                env = request.env(user=uid)

                try:
                    model_obj = env[model]
                except KeyError:
                    return self._safe_json_response({
                        'success': False,
                        'error': f'Model {model} not found',
                        'timestamp': datetime.now().isoformat()
                    }, 404)

                if not hasattr(model_obj, method):
                    return self._safe_json_response({
                        'success': False,
                        'error': f'Method {method} not found',
                        'timestamp': datetime.now().isoformat()
                    }, 404)

                method_func = getattr(model_obj, method)

                # Execute method
                try:
                    # Clean kwargs to remove custom parameters
                    cleaned_kwargs = self._clean_kwargs_for_odoo(kwargs)

                    if method in ['read', 'search_read', 'search', 'write', 'create', 'unlink']:
                        result = self._execute_odoo_method(method_func, method, args, cleaned_kwargs)
                    else:
                        # For custom methods
                        if args and cleaned_kwargs:
                            result = method_func(*args, **cleaned_kwargs)
                        elif args:
                            result = method_func(*args)
                        elif cleaned_kwargs:
                            result = method_func(**cleaned_kwargs)
                        else:
                            result = method_func()

                    _logger.info(f"Method {model}.{method} executed successfully")

                except Exception as method_error:
                    _logger.error(f"Method execution error: {str(method_error)}")
                    return self._safe_json_response({
                        'success': False,
                        'error': f'Method execution failed: {str(method_error)}',
                        'timestamp': datetime.now().isoformat()
                    }, 500)

                # Process result
                try:
                    if isinstance(result, dict) and 'success' in result:
                        processed_result = result
                    elif hasattr(result, 'ids') and hasattr(result, '_name'):
                        processed_result = result.ids
                    elif hasattr(result, 'read') and callable(getattr(result, 'read')) and hasattr(result, 'id'):
                        processed_result = result.read()
                    elif hasattr(result, 'id'):
                        processed_result = result.id
                    elif isinstance(result, (list, dict, str, int, float, bool, type(None))):
                        processed_result = result
                    else:
                        processed_result = str(result)

                    # Generic relational fields population using replaceToObject
                    replace_config = kwargs.get('replaceToObject', [])
                    if replace_config and isinstance(processed_result, list):
                        _logger.info(f"🔄 Processing replaceToObject for {model}")
                        processed_result = self._populate_relational_fields(processed_result, env, replace_config)
                        _logger.info(f"🎯 Relational fields population completed")
                except Exception as pe:
                    _logger.error(f"Result processing error: {str(pe)}")
                    processed_result = str(result) if result is not None else None

                return self._safe_json_response({
                    'success': True,
                    'result': processed_result,
                    'operation_info': {
                        'model': model,
                        'method': method,
                        'user': username
                    },
                    'timestamp': datetime.now().isoformat()
                })

            except Exception as e:
                _logger.error(f"Method execution error: {str(e)}", exc_info=True)
                return self._safe_json_response({
                    'success': False,
                    'error': f'Method error: {str(e)}',
                    'timestamp': datetime.now().isoformat()
                }, 500)

        except Exception as e:
            _logger.error(f"RPC error: {str(e)}", exc_info=True)
            return self._safe_json_response({
                'success': False,
                'error': 'RPC processing error',
                'timestamp': datetime.now().isoformat()
            }, 500)

    def _handle_lest_price_command(self, data):
        """Handle lest_price_command operation - Execute search_read for each product separately"""
        try:
            # Extract parameters
            db = data.get('db')
            username = data.get('username')
            password = data.get('password')
            model = data.get('model')
            method = data.get('method')
            kwargs = data.get('kwargs', {})

            _logger.info(f"Lest Price Command operation: {model}.{method}")

            # Validate required fields
            if not all([db, username, password, model, method]):
                return self._safe_json_response({
                    'success': False,
                    'error': 'Missing required fields (db, username, password, model, method)',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            if method != 'search_read':
                return self._safe_json_response({
                    'success': False,
                    'error': 'lest_price_command only supports search_read method',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            # FIXED: Authenticate using session.authenticate
            try:
                uid = request.session.authenticate(db, username, password)
                
                if not uid:
                    return self._safe_json_response({
                        'success': False,
                        'error': 'Invalid credentials',
                        'timestamp': datetime.now().isoformat()
                    }, 401)

                _logger.info(f"✅ Lest Price Command Authentication successful for UID: {uid}")

            except Exception as auth_error:
                _logger.error(f"Lest Price Command Authentication error: {str(auth_error)}")
                return self._safe_json_response({
                    'success': False,
                    'error': 'Authentication failed',
                    'timestamp': datetime.now().isoformat()
                }, 401)

            # Get domain and extract product_ids
            domain = kwargs.get('domain', [])
            fields = kwargs.get('fields', [])
            order = kwargs.get('order', '')
            limit = kwargs.get('limit', None)
            offset = kwargs.get('offset', 0)

            _logger.info(f"🔍 Original domain: {domain}")

            # Find product_id condition with 'in' operator
            product_ids = []
            base_domain = []
            product_field_found = False

            for condition in domain:
                if isinstance(condition, list) and len(condition) == 3:
                    field_name, operator, value = condition
                    if 'product_id' in field_name and operator == 'in' and isinstance(value, list):
                        product_ids = value
                        product_field_found = True
                        _logger.info(f"🎯 Found product_ids in domain: {product_ids}")
                    else:
                        # Keep other conditions for the base domain
                        base_domain.append(condition)
                else:
                    base_domain.append(condition)

            if not product_field_found:
                return self._safe_json_response({
                    'success': False,
                    'error': 'No product_id with "in" operator found in domain. Expected format: ["product_id", "in", [34,35,36]]',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            if not product_ids:
                return self._safe_json_response({
                    'success': False,
                    'error': 'Empty product_ids list found in domain',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            _logger.info(f"📋 Base domain (without product_id): {base_domain}")
            _logger.info(f"🛍️ Processing {len(product_ids)} products: {product_ids}")

            # Execute search_read for each product separately
            try:
                env = request.env(user=uid)
                model_obj = env[model]

                all_results = []
                execution_summary = {
                    'total_products': len(product_ids),
                    'successful_queries': 0,
                    'failed_queries': 0,
                    'total_records': 0,
                    'product_results': {}
                }

                for product_id in product_ids:
                    try:
                        # Create domain for this specific product
                        product_domain = base_domain + [['product_id', '=', product_id]]

                        _logger.info(f"🔍 Querying product {product_id} with domain: {product_domain}")

                        # Clean kwargs and execute search_read
                        search_kwargs = {
                            'domain': product_domain,
                            'fields': fields,
                            'order': order,
                            'limit': limit,
                            'offset': offset
                        }

                        # Remove empty/None values
                        search_kwargs = {k: v for k, v in search_kwargs.items() if v is not None and v != ''}

                        # Normalize order parameter (dec -> desc)
                        if 'order' in search_kwargs:
                            original_order = search_kwargs['order']
                            import re
                            normalized_order = re.sub(r'\b(dec)\b', 'desc', original_order, flags=re.IGNORECASE)
                            if normalized_order != original_order:
                                _logger.info(
                                    f"🔄 Normalized order for product {product_id}: '{original_order}' -> '{normalized_order}'")
                                search_kwargs['order'] = normalized_order

                        # Execute search_read
                        product_results = model_obj.search_read(**search_kwargs)

                        _logger.info(f"✅ Product {product_id}: Found {len(product_results)} records")

                        # Add product_id info to summary
                        execution_summary['product_results'][str(product_id)] = {
                            'records_count': len(product_results),
                            'success': True
                        }

                        # Add results to combined list
                        all_results.extend(product_results)

                        execution_summary['successful_queries'] += 1
                        execution_summary['total_records'] += len(product_results)

                    except Exception as product_error:
                        _logger.error(f"❌ Error querying product {product_id}: {str(product_error)}")

                        execution_summary['product_results'][str(product_id)] = {
                            'records_count': 0,
                            'success': False,
                            'error': str(product_error)
                        }
                        execution_summary['failed_queries'] += 1

                        continue

                _logger.info(
                    f"🎯 Lest Price Command completed: {execution_summary['total_records']} total records from {execution_summary['successful_queries']}/{execution_summary['total_products']} products")

                return self._safe_json_response({
                    'success': True,
                    'result': all_results,
                    'execution_summary': execution_summary,
                    'operation_info': {
                        'operation': 'lest_price_command',
                        'model': model,
                        'method': method,
                        'user': username,
                        'processed_products': product_ids,
                        'limit_per_product': limit
                    },
                    'timestamp': datetime.now().isoformat()
                })

            except Exception as execution_error:
                _logger.error(f"Execution error in lest_price_command: {str(execution_error)}")
                return self._safe_json_response({
                    'success': False,
                    'error': f'Execution error: {str(execution_error)}',
                    'timestamp': datetime.now().isoformat()
                }, 500)

        except Exception as e:
            _logger.error(f"Lest Price Command error: {str(e)}", exc_info=True)
            return self._safe_json_response({
                'success': False,
                'error': 'Lest Price Command processing error',
                'timestamp': datetime.now().isoformat()
            }, 500)

    def _safe_json_response(self, data, status_code=200):
        """Create a safe JSON response with CORS headers"""
        try:
            headers = [
                ('Content-Type', 'application/json'),
                ('Access-Control-Allow-Origin', '*'),
                ('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'),
                ('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization'),
            ]

            response_data = json.dumps(data, ensure_ascii=False, indent=2, default=str)
            return request.make_response(response_data, headers=headers, status=status_code)

        except Exception as e:
            _logger.error(f"Error creating JSON response: {str(e)}")
            # Fallback response
            fallback_data = {
                'success': False,
                'error': 'Response formatting error',
                'timestamp': datetime.now().isoformat()
            }
            headers = [
                ('Content-Type', 'application/json'),
                ('Access-Control-Allow-Origin', '*'),
            ]
            return request.make_response(json.dumps(fallback_data), headers=headers, status=500)

    def _handle_update(self, data):
        """Handle update operation - Complete synchronization with deletions detection + DOMAIN SUPPORT + LIMIT SUPPORT"""
        try:
            db = data.get('db')
            username = data.get('username')
            password = data.get('password')
            body = data.get('body', {})
            limit = data.get('limit')

            # Validate required fields
            if not all([db, username, password]):
                return self._safe_json_response({
                    'success': False,
                    'error': 'Missing required fields (db, username, password)',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            if not body or not isinstance(body, dict):
                return self._safe_json_response({
                    'success': False,
                    'error': 'Missing or invalid body field',
                    'expected_format': {
                        'model.name': {
                            'objects': [{'id': 1, 'write_date': '...', 'create_date': '...'}],
                            'fields': ['id', 'name', 'write_date'],
                            'domain': [['field', '=', 'value']],  # NEW: Domain filter support
                            'replaceToObject': [{
                                'relation_field': {
                                    'target.model': ['field1', 'field2']
                                }
                            }]
                        }
                    },
                    'timestamp': datetime.now().isoformat()
                }, 400)

            # Authenticate
            try:
                credential = {
                    'login': username,
                    'password': password,
                    'type': 'password'
                }

                auth_info = request.env['res.users'].authenticate(db, credential, {})

                if not auth_info or not auth_info.get('uid'):
                    return self._safe_json_response({
                        'success': False,
                        'error': 'Invalid credentials',
                        'timestamp': datetime.now().isoformat()
                    }, 401)

                uid = auth_info['uid']
                _logger.info(f"✅ Enhanced Update Authentication successful for UID: {uid}")

            except Exception as auth_error:
                _logger.error(f"Enhanced Update Authentication error: {str(auth_error)}")
                return self._safe_json_response({
                    'success': False,
                    'error': 'Authentication failed',
                    'timestamp': datetime.now().isoformat()
                }, 401)

            # Process each model and its objects
            env = request.env(user=uid)
            result = {}  # Combined: updated + missing objects
            delete_ids = {}  # Objects that are in payload but no longer exist in Odoo

            processed_count = 0
            updated_count = 0
            missing_count = 0
            deleted_count = 0
            
            # NOUVELLES VARIABLES POUR LE LIMIT SUPPORT
            total_result_objects = 0  # Compteur global des objets dans le résultat
            limit_reached = False  # Flag pour indiquer si on a atteint la limite

            # Calculate total objects for logging
            total_objects = sum(len(model_config.get('objects', [])) for model_config in body.values() if
                                isinstance(model_config, dict))
            _logger.info(f"🔢 Total objects to process: {total_objects} across {len(body)} models")

            for model_name, model_config in body.items():
                # ✨ NOUVELLES VÉRIFICATIONS DE LIMITE AU DÉBUT DE CHAQUE MODÈLE
                if limit is not None and total_result_objects >= limit:
                    limit_reached = True
                    _logger.info(f"🚫 LIMIT REACHED at model '{model_name}' - stopping processing (current: {total_result_objects}/{limit})")
                    break
                try:
                    _logger.info(f"🔄 Processing model '{model_name}' with enhanced features...")

                    # Validate model exists
                    try:
                        model_obj = env[model_name]
                    except KeyError:
                        _logger.error(f"Model '{model_name}' not found")
                        continue

                    # Validate model_config structure
                    if not isinstance(model_config, dict):
                        _logger.error(f"Model config for '{model_name}' should be a dict")
                        continue

                    objects_list = model_config.get('objects', [])
                    fields_to_return = model_config.get('fields', [])
                    replace_config = model_config.get('replaceToObject', [])
                    domain_filter = model_config.get('domain', [])

                    # NEW OPTIONS
                    only_significant = model_config.get('only_significant_modifications', False)
                    significant_threshold_hours = model_config.get('significant_threshold_hours', 1.0)
                    include_missing = model_config.get('include_missing', True)

                    # NEW: MANDATORY Domain filtering for provided objects
                    if domain_filter and objects_list:
                        _logger.info(f"🎯 APPLYING MANDATORY DOMAIN FILTER to {len(objects_list)} provided objects")
                        original_count = len(objects_list)
                        objects_list = self._apply_domain_filter_to_objects(model_obj, objects_list, domain_filter,
                                                                            model_name)
                        _logger.info(
                            f"📊 DOMAIN FILTER RESULT: {len(objects_list)}/{original_count} objects remain after filtering")

                        if not objects_list:
                            _logger.warning(
                                f"⚠️ No objects match domain conditions for '{model_name}' - skipping model processing")
                            continue

                    _logger.info(
                        f"⚙️ Options: only_significant={only_significant}, threshold={significant_threshold_hours}h, include_missing={include_missing}")

                    if not isinstance(objects_list, list) or not isinstance(fields_to_return, list):
                        _logger.error(f"Invalid objects or fields format for '{model_name}'")
                        continue

                    # NEW LOGIC: Handle empty objects_list - fetch ALL products
                    if not objects_list:
                        _logger.info(
                            f"📋 Empty objects_list for '{model_name}' - fetching ALL products with specified fields")

                        # Fetch all products using search_read
                        try:
                            # Determine fields to use
                            if fields_to_return:
                                # Use specified fields + ensure basic fields are included
                                basic_fields = ['id', 'name', 'display_name']
                                all_fields = list(set(basic_fields + fields_to_return))
                            else:
                                # Use default fields for the model
                                all_fields = self._get_default_fields_for_model(model_name)

                            # Get only available fields
                            available_fields = self._get_available_fields(model_obj, all_fields)

                            _logger.info(f"🎯 Fetching all {model_name} records with fields: {available_fields}")

                            # ✨ NOUVELLE LOGIQUE : Appliquer la limite lors du search_read si spécifiée
                            search_limit = None
                            if limit is not None:
                                remaining_limit = limit - total_result_objects
                                if remaining_limit <= 0:
                                    _logger.info(f"🚫 LIMIT REACHED before fetching '{model_name}' - skipping")
                                    continue
                                search_limit = remaining_limit
                                _logger.info(f"🎯 Applying search limit for '{model_name}': {search_limit} (remaining: {remaining_limit})")

                            # Execute search_read to get all records with limit
                            if search_limit:
                                all_records = model_obj.search_read([], available_fields, limit=search_limit)
                            else:
                                all_records = model_obj.search_read([], available_fields)

                            _logger.info(f"✅ Found {len(all_records)} records for '{model_name}'")

                            # Apply relational fields population if configured
                            if replace_config and all_records:
                                _logger.info(f"🔄 Processing replaceToObject for all {len(all_records)} records")
                                all_records = self._populate_relational_fields(all_records, env, replace_config)
                                _logger.info(f"✅ Relational fields population completed for all records")

                            # Store the results
                            result[model_name] = all_records
                            delete_ids[model_name] = []  # No deletions when fetching all

                            # Update summary counts
                            updated_count += len(all_records)
                            total_result_objects += len(all_records)  # ✨ NOUVEAU: Mise à jour du compteur global

                            _logger.info(
                                f"📦 Completed processing for '{model_name}': {len(all_records)} records fetched (total result objects: {total_result_objects})")

                            # ✨ NOUVEAU : Vérifier si on a atteint la limite après avoir traité ce modèle
                            if limit is not None and total_result_objects >= limit:
                                limit_reached = True
                                _logger.info(f"🎯 LIMIT REACHED after processing '{model_name}' ({total_result_objects}/{limit}) - stopping")
                                break

                        except Exception as fetch_error:
                            _logger.error(f"❌ Error fetching all records for '{model_name}': {str(fetch_error)}")
                            result[model_name] = []
                            delete_ids[model_name] = []

                        continue

                    _logger.info(f"Enhanced processing: {len(objects_list)} objects for '{model_name}'")
                    _logger.info(f"Include missing: {include_missing}")

                    # Initialize result containers
                    result[model_name] = []  # Will contain both updated and missing objects
                    delete_ids[model_name] = []  # Will contain IDs of objects that no longer exist in Odoo

                    # Get list of provided IDs for missing products detection
                    provided_ids = [obj.get('id') for obj in objects_list if obj.get('id')]
                    _logger.info(f"📝 Provided IDs: {provided_ids}")

                    # ORIGINAL FUNCTIONALITY: Check for updated objects
                    for obj_data in objects_list:
                        # ✨ NOUVELLE VÉRIFICATION DE LIMITE DANS LA BOUCLE D'OBJETS
                        if limit is not None and total_result_objects >= limit:
                            limit_reached = True
                            _logger.info(f"🚫 LIMIT REACHED during object processing for '{model_name}' (current: {total_result_objects}/{limit}) - breaking")
                            break
                        try:
                            processed_count += 1

                            if not isinstance(obj_data, dict) or 'id' not in obj_data:
                                _logger.warning(f"Invalid object data in {model_name}: {obj_data}")
                                continue

                            obj_id = obj_data['id']
                            client_write_date = obj_data.get('write_date')

                            if not client_write_date:
                                _logger.warning(f"No write_date provided for {model_name} ID {obj_id}")
                                continue

                            # Get the object from Odoo
                            try:
                                odoo_record = model_obj.browse([obj_id]).exists()

                                if not odoo_record:
                                    # Object no longer exists in Odoo - add to delete_ids
                                    delete_ids[model_name].append(obj_id)
                                    deleted_count += 1
                                    _logger.warning(
                                        f"❌ Object with ID {obj_id} not found in {model_name} - added to delete_ids")
                                    continue

                                # Read only write_date field for efficiency
                                record_data = odoo_record.read(['write_date'])

                                if not record_data:
                                    continue

                                odoo_write_date = record_data[0].get('write_date')

                                if not odoo_write_date:
                                    _logger.warning(f"No write_date found for {model_name} ID {obj_id} in Odoo")
                                    continue

                                # Convert dates to comparable format
                                from datetime import datetime

                                try:
                                    # Parse client date string to datetime
                                    if isinstance(client_write_date, str):
                                        # Handle ISO format with or without timezone
                                        if 'T' in client_write_date:
                                            if client_write_date.endswith('Z'):
                                                client_date = datetime.fromisoformat(
                                                    client_write_date.replace('Z', '+00:00'))
                                            elif '+' in client_write_date or client_write_date.count('-') > 2:
                                                client_date = datetime.fromisoformat(client_write_date)
                                            else:
                                                # No timezone info, assume UTC
                                                client_date = datetime.fromisoformat(client_write_date)
                                        else:
                                            # Try basic date formats (format from your data: "2025-08-26 19:48:58.132699")
                                            try:
                                                client_date = datetime.strptime(client_write_date,
                                                                                '%Y-%m-%d %H:%M:%S.%f')
                                            except ValueError:
                                                try:
                                                    client_date = datetime.strptime(client_write_date,
                                                                                    '%Y-%m-%d %H:%M:%S')
                                                except ValueError:
                                                    try:
                                                        client_date = datetime.strptime(client_write_date, '%Y-%m-%d')
                                                    except ValueError:
                                                        _logger.error(f"Unsupported date format: {client_write_date}")
                                                        continue
                                    else:
                                        client_date = client_write_date

                                    # odoo_write_date is already a datetime object
                                    odoo_date = odoo_write_date

                                    # Make both dates timezone-naive for comparison
                                    if hasattr(client_date, 'replace'):
                                        client_date_naive = client_date.replace(tzinfo=None)
                                    else:
                                        client_date_naive = client_date

                                    if hasattr(odoo_date, 'replace'):
                                        odoo_date_naive = odoo_date.replace(tzinfo=None)
                                    else:
                                        odoo_date_naive = odoo_date

                                    # Calculate time difference in hours for better logging
                                    time_diff_seconds = (odoo_date_naive - client_date_naive).total_seconds()
                                    time_diff_hours = time_diff_seconds / 3600

                                    _logger.info(f"🔄 Comparing dates for {model_name} ID {obj_id}:")
                                    _logger.info(f"   Client: {client_date_naive}")
                                    _logger.info(f"   Odoo:   {odoo_date_naive}")
                                    _logger.info(
                                        f"   Diff:   {time_diff_hours:.4f} hours ({time_diff_seconds:.2f} seconds)")

                                    # If Odoo write_date > client write_date, the object was modified
                                    # Use a small tolerance (1 second) to handle minor precision differences
                                    if time_diff_seconds > 1.0:
                                        # Check if we should filter out non-significant modifications
                                        if only_significant and time_diff_hours < significant_threshold_hours:
                                            _logger.info(
                                                f"⏭️ Skipping object {obj_id} - modification not significant enough ({time_diff_hours:.4f}h < {significant_threshold_hours}h)")
                                            continue
                                        # Classify modification type based on time difference
                                        if time_diff_hours >= 1.0:
                                            modification_type = "SIGNIFICANT"
                                            _logger.info(
                                                f"🔥 SIGNIFICANT MODIFICATION: Object {obj_id} modified {time_diff_hours:.2f} hours after creation")
                                        elif time_diff_seconds >= 60:
                                            modification_type = "MODERATE"
                                            _logger.info(
                                                f"⚠️ MODERATE MODIFICATION: Object {obj_id} modified {time_diff_seconds:.0f} seconds after creation")
                                        else:
                                            modification_type = "MINOR"
                                            _logger.info(
                                                f"ℹ️ MINOR MODIFICATION: Object {obj_id} modified {time_diff_seconds:.2f} seconds after creation")

                                        _logger.info(
                                            f"✅ Object {obj_id} was modified in Odoo (newer write_date) - {modification_type}")

                                        # Read the object with specified fields or all fields if none specified
                                        if fields_to_return:
                                            # Ensure write_date and id are always included for reference
                                            fields_with_meta = list(set(fields_to_return + ['write_date', 'id']))
                                            full_record_data = odoo_record.read(fields_with_meta)
                                            _logger.info(f"📋 Reading specific fields: {fields_with_meta}")
                                        else:
                                            # Read all fields if no specific fields requested
                                            full_record_data = odoo_record.read()
                                            _logger.info(f"📋 Reading all available fields")

                                        if full_record_data:
                                            result[model_name].append(full_record_data[0])
                                            updated_count += 1
                                            total_result_objects += 1  # ✨ NOUVEAU: Mise à jour du compteur global
                                            _logger.info(f"🎯 Added updated object {obj_id} to results (total result objects: {total_result_objects})")
                                    else:
                                        if time_diff_seconds <= -1.0:
                                            _logger.warning(
                                                f"⚠️ Object {obj_id} has OLDER write_date in Odoo (client is newer by {abs(time_diff_hours):.4f} hours)")
                                        else:
                                            _logger.info(
                                                f"❌ Object {obj_id} not modified (same or negligible difference: {time_diff_seconds:.2f}s)")

                                except Exception as date_error:
                                    _logger.error(
                                        f"Date comparison error for {model_name} ID {obj_id}: {str(date_error)}")
                                    continue

                            except Exception as record_error:
                                _logger.error(f"Error fetching record {model_name} ID {obj_id}: {str(record_error)}")
                                continue

                        except Exception as obj_error:
                            _logger.error(f"Error processing object in {model_name}: {str(obj_error)}")
                            continue

                    # ✨ NOUVEAU: Si on a atteint la limite pendant le traitement des objets, ne pas faire le missing
                    if limit_reached:
                        _logger.info(f"🚫 LIMIT REACHED - skipping missing products detection for '{model_name}'")
                    else:
                        try:
                            # NEW FUNCTIONALITY: Find missing products (exist in Odoo but not in provided list)
                            if include_missing:
                                _logger.info(f"🔍 Finding missing products for '{model_name}'...")
                                try:
                                    # Search for all records NOT in the provided IDs list
                                    if provided_ids:
                                        missing_domain = [('id', 'not in', provided_ids)]

                                        # Add active filter if the model supports it
                                        if 'active' in model_obj.fields_get():
                                            missing_domain.append(('active', '=', True))

                                    # ✨ NOUVEAU: Calculer la limite restante pour les objets manquants
                                    missing_limit = None
                                    if limit is not None:
                                            remaining_limit = limit - total_result_objects
                                            if remaining_limit <= 0:
                                                _logger.info(f"🚫 LIMIT REACHED - no space for missing objects in '{model_name}'")
                                            else:
                                                missing_limit = remaining_limit
                                                _logger.info(f"🎯 Limiting missing objects to {missing_limit} for '{model_name}'")

                                    if missing_limit is None or missing_limit > 0:
                                        if missing_limit:
                                            missing_records = model_obj.search(missing_domain, limit=missing_limit)
                                        else:
                                            missing_records = model_obj.search(missing_domain)

                                    _logger.info(f"📝 Found {len(missing_records)} missing records (not in provided list)")

                                    if missing_records:
                                        # Read missing records data
                                        if fields_to_return:
                                            fields_with_meta = list(set(fields_to_return + ['write_date', 'id']))
                                            missing_data = missing_records.read(fields_with_meta)
                                        else:
                                            missing_data = missing_records.read()

                                        # Add missing objects directly to result
                                        result[model_name].extend(missing_data)
                                        missing_count += len(missing_data)
                                        total_result_objects += len(missing_data)  # ✨ NOUVEAU: Mise à jour du compteur global
                                        _logger.info(f"🎯 Added {len(missing_data)} missing objects to result (total result objects: {total_result_objects})")
                                        
                                        # ✨ NOUVEAU: Vérifier si on a atteint la limite après avoir ajouté les objets manquants
                                        if limit is not None and total_result_objects >= limit:
                                            limit_reached = True
                                            _logger.info(f"🎯 LIMIT REACHED after adding missing objects for '{model_name}' ({total_result_objects}/{limit})")
                                    else:
                                        _logger.warning(f"No provided IDs to compare against for missing detection")

                                except Exception as inner_missing_error:
                                    _logger.error(f"Error in inner missing products search: {str(inner_missing_error)}")

                        except Exception as missing_error:
                            _logger.error(f"Error finding missing products: {str(missing_error)}")

                    _logger.info(f"✅ Model '{model_name}' enhanced processing completed")
                    
                    # ✨ NOUVEAU: Arrêter le traitement si on a atteint la limite
                    if limit_reached:
                        _logger.info(f"🚫 LIMIT REACHED - stopping processing at model '{model_name}'")
                        break

                except Exception as model_error:
                    _logger.error(f"Error processing model '{model_name}': {str(model_error)}")
                    continue

            # Apply replaceToObject to all result sets
            for model_name, model_config in body.items():
                try:
                    replace_config = model_config.get('replaceToObject', [])
                    if replace_config:
                        _logger.info(f"🔄 Applying replaceToObject for {model_name}...")

                        # Apply to all objects in result (both updated and missing)
                        if model_name in result and result[model_name]:
                            result[model_name] = self._populate_relational_fields(
                                result[model_name], env, replace_config)

                        _logger.info(f"✅ replaceToObject applied to all result sets for {model_name}")

                except Exception as replace_error:
                    _logger.error(f"Error applying replaceToObject for {model_name}: {str(replace_error)}")
                    continue

            # Clean up empty models from delete_ids
            delete_ids = {model: ids for model, ids in delete_ids.items() if ids}

            # Prepare enhanced response
            response_data = {
                'success': True,
                'result': result,  # Combined: both updated and missing objects
                'delete_ids': delete_ids,  # Objects that exist in payload but not in Odoo
                'summary': {
                    'total_processed': processed_count,
                    'total_updated': updated_count,
                    'total_missing': missing_count,
                    'total_deleted': deleted_count,
                    'total_objects': updated_count + missing_count,
                    'models_processed': list(body.keys()),
                    'has_updated': updated_count > 0,
                    'has_missing': missing_count > 0,
                    'has_deleted': deleted_count > 0,
                    # ✨ NOUVELLES INFORMATIONS LIÉES AU LIMIT
                    'limit_applied': limit,
                    'limit_reached': limit_reached,
                    'total_result_objects': total_result_objects
                },
                'timestamp': datetime.now().isoformat()
            }

            _logger.info(f"🎯 Enhanced Update Summary:")
            _logger.info(f"   - Processed: {processed_count} objects")
            _logger.info(f"   - Updated: {updated_count} objects")
            _logger.info(f"   - Missing: {missing_count} objects")
            _logger.info(f"   - Deleted: {deleted_count} objects")
            _logger.info(f"   - Total in result: {updated_count + missing_count} objects")
            # ✨ NOUVEAU LOG POUR LE LIMIT
            if limit is not None:
                _logger.info(f"   - Limit applied: {limit}")
                _logger.info(f"   - Limit reached: {limit_reached}")
                _logger.info(f"   - Total result objects: {total_result_objects}")

            return self._safe_json_response(response_data)

        except Exception as e:
            _logger.error(f"Update operation error: {str(e)}", exc_info=True)
            return self._safe_json_response({
                'success': False,
                'error': 'Update operation processing error',
                'details': str(e),
                'timestamp': datetime.now().isoformat()
            }, 500)

    @http.route('/config', type='http', auth='public', methods=['POST'], csrf=False)
    def config(self, **kwargs):
        """Configuration endpoint for users - Odoo 18 Compatible"""
        try:
            # CORS
            if request.httprequest.method == 'OPTIONS':
                headers = [
                    ('Access-Control-Allow-Origin', '*'),
                    ('Access-Control-Allow-Methods', 'POST, OPTIONS'),
                    ('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization'),
                ]
                return request.make_response("", headers=headers)

            if not request.httprequest.data:
                _logger.error("Empty request body received")
                return self._safe_json_response({
                    'success': False,
                    'error': 'Empty request body',
                    'timestamp': datetime.now().isoformat()
                }, 400)

            return self._safe_json_response({
                "success": True,
                "show": True,
                "form": {
                    "baseUrl": request.httprequest.host_url.rstrip('/'),
                    "wsUrl": "http://185.158.132.243:9570",
                    "imagesServer": "http://185.158.132.243:7000/static/images",
                    "database": 'odoo',
                    "btnLogout": True,
                    "code": ''
                },
                "odoo_version": "18.0",
                "api_version": "2.0"
            })

        except Exception as e:
            _logger.error(f"Config endpoint error: {str(e)}", exc_info=True)
            return self._safe_json_response({
                'success': False,
                'error': 'Server error',
                'timestamp': datetime.now().isoformat()
            }, 500)

    @http.route('/odoo-rpc', type='http', auth='public', methods=['POST', 'OPTIONS'], csrf=False)
    def odoo_rpc(self, **kwargs):
        """Main RPC endpoint"""
        try:
            # CORS
            if request.httprequest.method == 'OPTIONS':
                headers = [
                    ('Access-Control-Allow-Origin', '*'),
                    ('Access-Control-Allow-Methods', 'POST, OPTIONS'),
                    ('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization'),
                ]
                return request.make_response('', headers=headers)

            # Parse request
            try:
                if not request.httprequest.data:
                    return self._safe_json_response({
                        'success': False,
                        'error': 'Empty request body',
                        'timestamp': datetime.now().isoformat()
                    }, 400)
                data = json.loads(request.httprequest.data.decode('utf-8'))
                operation = data.get('operation')
                if not operation:
                    return self._safe_json_response({
                        'success': False,
                        'error': 'Missing operation field',
                        'timestamp': datetime.now().isoformat()
                    }, 400)

                elif operation == 'auth':
                    return self._handle_auth(data)
                elif operation == 'rpc':
                    return self._handle_rpc(data)
                elif operation == 'update':
                    return self._handle_update(data)
                elif operation == 'lest_price_command':
                    return self._handle_lest_price_command(data)
                else:
                    return self._safe_json_response({
                        'success': False,
                        'error': f'Unknown operation: {operation}',
                        'available_operations': ['auth', 'rpc', 'update', 'lest_price_command'],
                        'timestamp': datetime.now().isoformat()
                    }, 400)

            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                _logger.error(f"Request parsing error: {str(e)}")
                return self._safe_json_response({
                    'success': False,
                    'error': 'Invalid request format',
                    'timestamp': datetime.now().isoformat()
                }, 400)

        except Exception as e:
            _logger.error(f"Unexpected error: {str(e)}", exc_info=True)
            # Use the global datetime import
            return self._safe_json_response({
                'success': False,
                'error': 'Server error',
                'timestamp': datetime.now().isoformat()
            }, 500)
