/**
 * ScheduleLive Auth Configuration
 * ================================
 * Replace these values after deploying the Cognito User Pool via SAM.
 * Run: sam deploy → check Outputs for UserPoolId and UserPoolClientId.
 */
var AUTH_CONFIG = {
  UserPoolId: 'us-east-1_5paVOERWp',
  ClientId: '7qr82gr0hesb7g312m57r2hdl7',
  Region: 'us-east-1',
  ApiUrl: 'https://zta7che674.execute-api.us-east-1.amazonaws.com/api'
};
