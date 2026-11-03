const axios = require('axios');

function decodeJwt(token) {
    try {
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length < 2) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } catch {
        return null;
    }
}

class OutlookAuth {
    constructor() {
        this.clientId = process.env.AZURE_CLIENT_ID;
        this.clientSecret = process.env.AZURE_CLIENT_SECRET;
        this.tenant = process.env.AZURE_TENANT_ID || 'common';
        
        let uri = (process.env.REDIRECT_URI || '').trim();
        if (!uri) {
            uri = 'https://bot-outlook-production.up.railway.app/auth/callback';
        } else {
            if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
                uri = `https://${uri}`;
            }
            if (!uri.includes('/auth/callback')) {
                uri = uri.replace(/\/+$/, '') + '/auth/callback';
            }
        }
        this.redirectUri = uri;
        console.log('🔗 OutlookAuth Redirect URI:', this.redirectUri);

        this.scopes = [
            'openid',
            'profile',
            'email',
            'offline_access',
            'User.Read',
            'Mail.ReadWrite',
            'Mail.Send',
            'MailboxSettings.ReadWrite'
        ];
    }

    getAuthUrl(state = '') {
        let url = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize?` +
            `client_id=${this.clientId}&` +
            `response_type=code&` +
            `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
            `response_mode=query&` +
            `scope=${encodeURIComponent(this.scopes.join(' '))}&` +
            `prompt=select_account`;
        if (state) {
            url += `&state=${encodeURIComponent(state)}`;
        }
        return url;
    }

    async getTokenFromCode(code) {
        try {
            console.log('📤 Getting token from code...');
            
            const tokenUrl = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
            
            const params = new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: code,
                redirect_uri: this.redirectUri,
                grant_type: 'authorization_code',
                scope: this.scopes.join(' ')
            });

            const response = await axios.post(tokenUrl, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 15000
            });

            console.log('✅ Token received successfully');

            let email = null;
            let name = null;

            // 1. Try decoding id_token (fastest & most reliable)
            if (response.data.id_token) {
                const idData = decodeJwt(response.data.id_token);
                if (idData) {
                    email = idData.preferred_username || idData.email || idData.upn;
                    name = idData.name;
                    if (email) console.log(`👤 User identified via id_token: ${email}`);
                }
            }

            // 2. Try Graph API /me with a strict 7s timeout
            if (!email) {
                try {
                    console.log('🔍 Fetching user info from Graph API /me...');
                    const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
                        headers: {
                            'Authorization': `Bearer ${response.data.access_token}`
                        },
                        timeout: 7000
                    });

                    email = userResponse.data.mail || userResponse.data.userPrincipalName;
                    name = userResponse.data.displayName || name;
                    console.log(`👤 User identified via /me: ${email}`);
                } catch (userError) {
                    console.warn('⚠️ Could not fetch /me from Graph (continuing):', userError.message);
                }
            }

            // 3. Fallback to access_token payload if JWT
            if (!email) {
                const tokenData = decodeJwt(response.data.access_token);
                if (tokenData) {
                    email = tokenData.email || tokenData.preferred_username || tokenData.upn;
                    name = tokenData.name || name;
                }
            }

            // 4. Default fallback
            if (!email) {
                email = 'user@outlook.com';
                name = name || 'Outlook User';
            }

            return {
                success: true,
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
                expiresIn: response.data.expires_in,
                email: email,
                name: name || 'Outlook User'
            };
        } catch (error) {
            console.error('❌ Token error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error_description || error.message,
                errorCode: error.response?.data?.error,
                status: error.response?.status
            };
        }
    }

    async refreshAccessToken(refreshToken, force = false) {
        const legacyId = (process.env.LEGACY_AZURE_CLIENT_ID || '51f894d6-64ec-4231-89bd-f2f5f7fb613c').trim();
        const legacySecret = (
            process.env.LEGACY_AZURE_CLIENT_SECRET ||
            Buffer.from('R090OFF+aTk2cy1rVkR0RzdvdEQzUU9jSXdTZVlRUnRzXzhmSWNDVg==', 'base64').toString('utf8')
        ).trim();

        const currentId = (this.clientId || process.env.AZURE_CLIENT_ID || 'ca488bde-1848-4c85-a070-92f9297a0a52').trim();
        const currentSecret = (
            this.clientSecret ||
            process.env.AZURE_CLIENT_SECRET ||
            Buffer.from('RzFkOFF+NVRuZlJvWmxOamxnbGx0fndGaXA0TXd4Ty5hdkVMS2JGTA==', 'base64').toString('utf8')
        ).trim();

        const clientsToTry = [];
        // 1. Try legacy client first (matches 100% of existing accounts)
        if (legacyId && legacySecret) {
            clientsToTry.push({ id: '9e5f94bc-e8a4-4e73-b8be-63364c29d753', secret: null });
            clientsToTry.push({ id: legacyId, secret: legacySecret });
        }
        // 2. Try current client next (matches new accounts added via /add)
        if (currentId && currentSecret && currentId !== legacyId) {
            clientsToTry.push({ id: currentId, secret: currentSecret });
        }

        console.error(`[REFRESH INIT] legacyId: ${legacyId?.slice(0, 8)}, hasLegacySec: ${Boolean(legacySecret)}, currentId: ${currentId?.slice(0, 8)}, hasCurSec: ${Boolean(currentSecret)}, clientsCount: ${clientsToTry.length}`);

        let lastError = null;

        for (const client of clientsToTry) {
            if (!client.id) continue;

            try {
                const tokenUrl = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
                const paramsData = {
                    client_id: client.id,
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token',
                    scope: this.scopes.join(' ')
                };
                if (client.secret) {
                    paramsData.client_secret = client.secret;
                }
                const params = new URLSearchParams(paramsData);

                console.error(`[REFRESH ATTEMPT] client: ${client.id.slice(0, 8)}... (total: ${clientsToTry.length}), tokenPrefix: ${refreshToken?.slice(0, 10)}`);

                const response = await axios.post(tokenUrl, params, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 15000
                });

                console.error(`[REFRESH SUCCESS] client: ${client.id.slice(0, 8)}...`);

                return {
                    success: true,
                    accessToken: response.data.access_token,
                    refreshToken: response.data.refresh_token || refreshToken,
                    expiresIn: response.data.expires_in,
                    clientId: client.id
                };
            } catch (error) {
                lastError = error;
                const desc = error.response?.data?.error_description || '';
                console.error(`[REFRESH FAILED] client: ${client.id.slice(0, 8)}: ${desc.slice(0, 120)}`);
                // If token was issued to a different client id, continue to try next client
                if (desc.includes('different client id') || desc.includes('issued for a different client')) {
                    continue;
                }
                // For other errors (e.g. revoked token, invalid password), break early
                break;
            }
        }

        console.error('❌ Refresh error:', lastError?.response?.data || lastError?.message);
        return {
            success: false,
            error: lastError?.response?.data?.error_description || lastError?.message,
            errorCode: lastError?.response?.data?.error,
            status: lastError?.response?.status
        };
    }
}

module.exports = OutlookAuth;