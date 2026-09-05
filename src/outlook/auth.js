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
            uri = 'https://outlook-telegram-bot-production.up.railway.app/auth/callback';
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

    getAuthUrl() {
        return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize?` +
            `client_id=${this.clientId}&` +
            `response_type=code&` +
            `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
            `response_mode=query&` +
            `scope=${encodeURIComponent(this.scopes.join(' '))}&` +
            `prompt=select_account`;
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
    try {
        
        const tokenUrl = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
        
        const params = new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: this.scopes.join(' ')
        });

        const response = await axios.post(tokenUrl, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });


        return {
            success: true,
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token || refreshToken,
            expiresIn: response.data.expires_in
        };
    } catch (error) {
        console.error('❌ Refresh error:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error_description || error.message,
            errorCode: error.response?.data?.error,
            status: error.response?.status
        };
    }
}
}

module.exports = OutlookAuth;