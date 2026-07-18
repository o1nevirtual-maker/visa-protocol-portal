from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    data = request.get_json()
    amount = data.get('amount')
    if not amount:
        return jsonify({'error': 'Amount is required'}), 400

    # Replace with your actual USD to USDT conversion logic
    # For example, using a stablecoin bridge or an exchange API
    # Here, we'll simulate a conversion:
    usdt_amount = amount  # Assuming 1 USD = 1 USDT for simplicity

    return jsonify({
        'success': True,
        'amount': usdt_amount,
        'currency': 'USDT'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
